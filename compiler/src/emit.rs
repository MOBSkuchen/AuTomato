use crate::ast::*;
use crate::registry::{ComponentDef, Consumption, ModuleManifest, Registry, TriggerStyle};
use crate::typecheck::{derived_category, lookup_enum_variants, resolve_struct_type, StructInfo};
use anyhow::{anyhow, bail, Result};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write;

pub fn emit_ast_json(workflow: &Workflow) -> Result<String> {
    Ok(serde_json::to_string_pretty(workflow)?)
}

pub struct GoFile {
    pub body: String,
    pub imports: BTreeMap<String, String>,
}

pub fn emit_main(wf: &Workflow, reg: &Registry) -> Result<GoFile> {
    let mut gen = Generator::new(wf, reg)?;
    let plan = gen.build()?;
    Ok(gen.finalize(plan))
}

struct TriggerFn {
    name: String,
    params: Vec<(String, String)>,
    body: String,
}

struct Generator<'a> {
    wf: &'a Workflow,
    reg: &'a Registry,
    nodes: HashMap<&'a str, &'a NodeInstance>,
    data_in: HashMap<(&'a str, String), (&'a str, String)>,
    exec_out: HashMap<(&'a str, String), &'a str>,

    emitted_action: HashSet<String>,
    emitted_pure: HashSet<String>,
    emitted_constant: HashSet<String>,

    body: String,
    indent: usize,
    imports: BTreeMap<String, &'a ModuleManifest>,
    uses_fmt: bool,
    uses_os: bool,
    trigger_fns: Vec<TriggerFn>,
    dispatch_rooted: bool,
}

enum BuildPlan {
    Legacy(LegacyPlan),
    DispatchRooted,
}

struct LegacyPlan {
    trigger_alias: String,
    trigger_fn: String,
    trigger_style: TriggerStyle,
    trigger_output_count: usize,
    workflow_params: Vec<(String, String)>,
    trigger_tweak_args: Vec<String>,
}

impl<'a> Generator<'a> {
    fn new(wf: &'a Workflow, reg: &'a Registry) -> Result<Self> {
        let nodes: HashMap<&str, &NodeInstance> =
            wf.nodes.iter().map(|n| (n.id.as_str(), n)).collect();

        let mut data_in: HashMap<(&str, String), (&str, String)> = HashMap::new();
        let mut exec_out: HashMap<(&str, String), &str> = HashMap::new();
        for e in &wf.edges {
            match e.kind {
                EdgeKind::Data => {
                    data_in.insert(
                        (e.to_node.as_str(), e.to_port.clone()),
                        (e.from_node.as_str(), e.from_port.clone()),
                    );
                }
                EdgeKind::Exec => {
                    exec_out.insert(
                        (e.from_node.as_str(), e.from_port.clone()),
                        e.to_node.as_str(),
                    );
                }
            }
        }

        Ok(Self {
            wf,
            reg,
            nodes,
            data_in,
            exec_out,
            emitted_action: HashSet::new(),
            emitted_pure: HashSet::new(),
            emitted_constant: HashSet::new(),
            body: String::new(),
            indent: 1,
            imports: BTreeMap::new(),
            uses_fmt: false,
            uses_os: false,
            trigger_fns: Vec::new(),
            dispatch_rooted: false,
        })
    }

    fn build(&mut self) -> Result<BuildPlan> {
        let has_origin = self.wf.nodes.iter().any(|n| n.kind == NodeKind::Origin);
        if has_origin {
            self.build_dispatch_rooted()
        } else {
            self.build_legacy()
        }
    }

    fn build_legacy(&mut self) -> Result<BuildPlan> {
        let entry_id = self
            .wf
            .entry
            .clone()
            .or_else(|| {
                if !self.wf.entries.is_empty() {
                    Some(self.wf.entries[0].clone())
                } else {
                    self.wf
                        .nodes
                        .iter()
                        .find(|n| derived_category(n, self.reg) == Some(NodeCategory::Trigger))
                        .map(|n| n.id.clone())
                }
            })
            .ok_or_else(|| anyhow!("workflow has no trigger node"))?;

        let trigger_node = *self
            .nodes
            .get(entry_id.as_str())
            .ok_or_else(|| anyhow!("entry '{entry_id}' not found"))?;
        let (trigger_module, trigger_comp) = self.lookup(trigger_node)?;
        self.register_import(trigger_module);

        let trigger_style = trigger_comp
            .trigger_style
            .clone()
            .ok_or_else(|| {
                anyhow!(
                    "trigger component '{}/{}' is missing trigger_style (polling | callback)",
                    trigger_module.id,
                    trigger_comp.name
                )
            })?;

        let mut params = Vec::with_capacity(trigger_comp.outputs.len());
        for out in &trigger_comp.outputs {
            let var = format!("var_{}_{}", sanitize(&trigger_node.id), sanitize(&out.name));
            let go_ty = self.go_type(&out.ty)?;
            params.push((var, go_ty));
        }
        let trigger_fn = trigger_comp.impl_function.clone().ok_or_else(|| {
            anyhow!(
                "trigger component '{}/{}' has no impl function",
                trigger_module.id,
                trigger_comp.name
            )
        })?;
        let trigger_tweak_args = self.resolve_tweak_args(trigger_node, trigger_comp)?;
        self.emitted_action.insert(trigger_node.id.clone());

        if let Some(next) = self
            .exec_out
            .get(&(trigger_node.id.as_str(), EXEC_OUT.to_string()))
            .copied()
        {
            self.emit_node_chain(next)?;
        }

        Ok(BuildPlan::Legacy(LegacyPlan {
            trigger_alias: trigger_module.alias.clone(),
            trigger_fn,
            trigger_style,
            trigger_output_count: trigger_comp.outputs.len(),
            workflow_params: params,
            trigger_tweak_args,
        }))
    }

    fn build_dispatch_rooted(&mut self) -> Result<BuildPlan> {
        self.dispatch_rooted = true;
        let origin = self
            .wf
            .nodes
            .iter()
            .find(|n| n.kind == NodeKind::Origin)
            .ok_or_else(|| anyhow!("dispatch-rooted workflow has no origin node"))?;

        self.emitted_action.insert(origin.id.clone());

        if let Some(next) = self
            .exec_out
            .get(&(origin.id.as_str(), EXEC_OUT.to_string()))
            .copied()
        {
            self.emit_node_chain(next)?;
        }

        Ok(BuildPlan::DispatchRooted)
    }

    fn lookup(&self, node: &NodeInstance) -> Result<(&'a ModuleManifest, &'a ComponentDef)> {
        let module = self.reg.require(&node.module_id)?;
        let comp = module.component(&node.component).ok_or_else(|| {
            anyhow!(
                "module '{}' has no component '{}'",
                node.module_id,
                node.component
            )
        })?;
        Ok((module, comp))
    }

    fn emit_node_chain(&mut self, start: &'a str) -> Result<()> {
        let mut cur = Some(start);
        while let Some(id) = cur {
            let node = *self
                .nodes
                .get(id)
                .ok_or_else(|| anyhow!("edge points to unknown node '{id}'"))?;
            cur = self.emit_node(node)?;
        }
        Ok(())
    }

    fn emit_node(&mut self, node: &'a NodeInstance) -> Result<Option<&'a str>> {
        let cat = derived_category(node, self.reg);
        match node.kind {
            NodeKind::Branch => {
                self.emit_branch(node)?;
                Ok(None)
            }
            NodeKind::Loop => {
                self.emit_loop(node)?;
                Ok(None)
            }
            NodeKind::Exit => {
                self.emit_exit(node)?;
                Ok(None)
            }
            NodeKind::EnvConst | NodeKind::Constant => {
                self.ensure_pure_emitted(node)?;
                Ok(self
                    .exec_out
                    .get(&(node.id.as_str(), EXEC_OUT.to_string()))
                    .copied())
            }
            _ if cat == Some(NodeCategory::Return) => {
                self.emit_return(node)?;
                Ok(None)
            }
            _ if cat == Some(NodeCategory::Dispatch) => {
                self.emit_dispatch(node)?;
                Ok(self
                    .exec_out
                    .get(&(node.id.as_str(), EXEC_OUT.to_string()))
                    .copied())
            }
            NodeKind::Construct | NodeKind::Destruct => {
                self.ensure_pure_emitted(node)?;
                Ok(self
                    .exec_out
                    .get(&(node.id.as_str(), EXEC_OUT.to_string()))
                    .copied())
            }
            _ => {
                self.emit_action(node)?;
                Ok(self
                    .exec_out
                    .get(&(node.id.as_str(), EXEC_OUT.to_string()))
                    .copied())
            }
        }
    }

    fn emit_action(&mut self, node: &'a NodeInstance) -> Result<()> {
        let (module, comp) = self.lookup(node)?;
        self.register_import(module);
        let mut args = self.resolve_tweak_args(node, comp)?;
        args.extend(self.resolve_args(node, comp)?);
        self.emit_call(node, module, comp, &args)?;
        self.emitted_action.insert(node.id.clone());

        if comp.error_type.is_some() {
            let err_var = format!("err_{}", sanitize(&node.id));
            self.line(&format!("if {} != nil {{", err_var));
            self.indent += 1;
            if let Some(err_next) = self
                .exec_out
                .get(&(node.id.as_str(), EXEC_ERR.to_string()))
                .copied()
            {
                self.emit_node_chain(err_next)?;
            } else {
                self.uses_fmt = true;
                self.line(&format!(
                    "fmt.Printf(\"unhandled error in {}/{}: %v\\n\", {})",
                    node.module_id, node.component, err_var
                ));
                self.line("return");
            }
            self.indent -= 1;
            self.line("}");
        }
        Ok(())
    }

    fn emit_call(
        &mut self,
        node: &NodeInstance,
        module: &ModuleManifest,
        comp: &ComponentDef,
        args: &[String],
    ) -> Result<()> {
        let fn_name = comp.impl_function.as_deref().ok_or_else(|| {
            anyhow!(
                "node {}: component '{}' has no impl function",
                node.id,
                comp.name
            )
        })?;
        let nid = sanitize(&node.id);
        let call = format!(
            "{}.{}({})",
            module.alias,
            fn_name,
            args.join(", ")
        );
        let mut lhs: Vec<String> = comp
            .outputs
            .iter()
            .map(|o| format!("var_{}_{}", nid, sanitize(&o.name)))
            .collect();
        if comp.error_type.is_some() {
            lhs.push(format!("err_{}", nid));
        }
        if lhs.is_empty() {
            self.line(&call);
        } else {
            self.line(&format!("{} := {}", lhs.join(", "), call));
            for v in &lhs {
                self.line(&format!("_ = {}", v));
            }
        }
        Ok(())
    }

    fn emit_return(&mut self, node: &'a NodeInstance) -> Result<()> {
        let (module, comp) = self.lookup(node)?;
        self.register_import(module);
        let mut args = self.resolve_tweak_args(node, comp)?;
        args.extend(self.resolve_args(node, comp)?);
        let nid = sanitize(&node.id);
        let fn_name = comp.impl_function.as_deref().ok_or_else(|| {
            anyhow!("node {}: return component '{}' has no impl function", node.id, comp.name)
        })?;
        let call = format!(
            "{}.{}({})",
            module.alias,
            fn_name,
            args.join(", ")
        );
        if comp.outputs.is_empty() && comp.error_type.is_none() {
            self.line(&call);
        } else {
            let mut lhs: Vec<String> = comp
                .outputs
                .iter()
                .map(|o| format!("var_{}_{}", nid, sanitize(&o.name)))
                .collect();
            if comp.error_type.is_some() {
                lhs.push(format!("err_{}", nid));
            }
            self.line(&format!("{} := {}", lhs.join(", "), call));
            for v in &lhs {
                self.line(&format!("_ = {}", v));
            }
        }
        self.line("return");
        Ok(())
    }

    fn emit_branch(&mut self, node: &'a NodeInstance) -> Result<()> {
        let cond_expr = self.resolve_port_expr(node, "cond", Some(&TypeRef::Bool))?;
        self.line(&format!("if {} {{", cond_expr));
        self.indent += 1;
        if let Some(t) = self
            .exec_out
            .get(&(node.id.as_str(), EXEC_TRUE.to_string()))
            .copied()
        {
            self.emit_node_chain(t)?;
        }
        self.indent -= 1;
        self.line("} else {");
        self.indent += 1;
        if let Some(f) = self
            .exec_out
            .get(&(node.id.as_str(), EXEC_FALSE.to_string()))
            .copied()
        {
            self.emit_node_chain(f)?;
        }
        self.indent -= 1;
        self.line("}");
        Ok(())
    }

    fn emit_loop(&mut self, node: &'a NodeInstance) -> Result<()> {
        let list_expr = self.resolve_port_expr(node, "list", None)?;
        let nid = sanitize(&node.id);
        let item_var = format!("var_{}_{}", nid, sanitize(DATA_LOOP_ITEM));
        self.line(&format!("for _, {} := range {} {{", item_var, list_expr));
        self.indent += 1;
        self.line(&format!("_ = {}", item_var));
        if let Some(body) = self
            .exec_out
            .get(&(node.id.as_str(), EXEC_BODY.to_string()))
            .copied()
        {
            self.emit_node_chain(body)?;
        }
        self.indent -= 1;
        self.line("}");
        if let Some(done) = self
            .exec_out
            .get(&(node.id.as_str(), EXEC_DONE.to_string()))
            .copied()
        {
            self.emit_node_chain(done)?;
        }
        Ok(())
    }

    fn emit_exit(&mut self, node: &'a NodeInstance) -> Result<()> {
        self.uses_os = true;
        self.emitted_action.insert(node.id.clone());
        if let Some((src_id, src_port)) = self
            .data_in
            .get(&(node.id.as_str(), DATA_EXIT_CODE.to_string()))
            .cloned()
        {
            let code_expr = self.resolve_source(src_id, &src_port)?;
            self.line(&format!("os.Exit(int({}))", code_expr));
        } else {
            self.line("os.Exit(0)");
        }
        Ok(())
    }

    fn emit_dispatch(&mut self, node: &'a NodeInstance) -> Result<()> {
        let (module, comp) = self.lookup(node)?;
        self.register_import(module);

        let ctor = comp.impl_function.as_deref().ok_or_else(|| {
            anyhow!(
                "dispatch component '{}/{}' has no impl function (constructor)",
                module.id,
                comp.name
            )
        })?;

        let mut args = self.resolve_tweak_args(node, comp)?;
        args.extend(self.resolve_args(node, comp)?);
        let dispatch_var = format!("dispatch_{}", sanitize(&node.id));
        self.line(&format!(
            "{} := {}.{}({})",
            dispatch_var,
            module.alias,
            ctor,
            args.join(", ")
        ));
        self.line(&format!("_ = {}", dispatch_var));
        self.emitted_action.insert(node.id.clone());

        let dispatch_type_name = match &comp.dispatch_type {
            Some(TypeRef::Custom { name }) => Some(name.clone()),
            _ => None,
        };
        let dispatch_out_ports: Vec<String> = comp
            .outputs
            .iter()
            .filter(|o| match (&o.ty, &dispatch_type_name) {
                (TypeRef::Custom { name: a }, Some(b)) => a == b,
                _ => false,
            })
            .map(|o| o.name.clone())
            .collect();

        let trigger_ids: Vec<&'a str> = self
            .wf
            .edges
            .iter()
            .filter(|e| {
                e.from_node == node.id
                    && e.kind == EdgeKind::Data
                    && dispatch_out_ports.iter().any(|p| p == &e.from_port)
            })
            .map(|e| {
                let id: &'a str = self
                    .nodes
                    .get(e.to_node.as_str())
                    .map(|n| n.id.as_str())
                    .unwrap_or("");
                id
            })
            .filter(|id| !id.is_empty())
            .collect();

        for trigger_id in trigger_ids {
            let trigger_node = self.nodes[trigger_id];
            let (tmod, tcomp) = self.lookup(trigger_node)?;
            self.register_import(tmod);

            let register_method = comp
                .register_methods
                .get(&tcomp.name)
                .cloned()
                .unwrap_or_else(|| "Register".to_string());

            let fn_name = format!("WorkflowEntry_{}", sanitize(trigger_id));
            let trigger_tweak_args = self.resolve_tweak_args(trigger_node, tcomp)?;
            let mut reg_args = trigger_tweak_args;
            reg_args.push(fn_name.clone());
            self.line(&format!(
                "{}.{}({})",
                dispatch_var,
                register_method,
                reg_args.join(", ")
            ));

            let tfn = self.emit_trigger_function(trigger_node, &fn_name)?;
            self.trigger_fns.push(tfn);
        }

        let run_method = comp.run_method.as_deref().unwrap_or("Run");
        self.line(&format!("{}.{}()", dispatch_var, run_method));
        Ok(())
    }

    fn emit_trigger_function(&mut self, trigger_node: &'a NodeInstance, fn_name: &str) -> Result<TriggerFn> {
        let (_, tcomp) = self.lookup(trigger_node)?;

        let mut params: Vec<(String, String)> = Vec::with_capacity(tcomp.outputs.len());
        for out in &tcomp.outputs {
            let var = format!("var_{}_{}", sanitize(&trigger_node.id), sanitize(&out.name));
            let go_ty = self.go_type(&out.ty)?;
            params.push((var, go_ty));
        }

        let saved_body = std::mem::take(&mut self.body);
        let saved_indent = self.indent;
        let saved_emitted_action = self.emitted_action.clone();
        let saved_emitted_pure = self.emitted_pure.clone();
        let saved_emitted_constant = self.emitted_constant.clone();

        self.body = String::new();
        self.indent = 1;
        self.emitted_action.insert(trigger_node.id.clone());

        if let Some(next) = self
            .exec_out
            .get(&(trigger_node.id.as_str(), EXEC_OUT.to_string()))
            .copied()
        {
            self.emit_node_chain(next)?;
        }

        let fn_body = std::mem::replace(&mut self.body, saved_body);
        self.indent = saved_indent;
        self.emitted_action = saved_emitted_action;
        self.emitted_pure = saved_emitted_pure;
        self.emitted_constant = saved_emitted_constant;

        Ok(TriggerFn {
            name: fn_name.to_string(),
            params,
            body: fn_body,
        })
    }

    fn emit_env_const(&mut self, node: &'a NodeInstance) -> Result<String> {
        self.uses_os = true;
        let var = format!("var_{}_value", sanitize(&node.id));
        if self.emitted_constant.insert(node.id.clone()) {
            let key = node.env_key.as_deref().unwrap_or("");
            let default = node.env_default.as_deref().unwrap_or("");
            self.line(&format!("{} := os.Getenv({:?})", var, key));
            if !default.is_empty() {
                self.line(&format!("if {} == \"\" {{", var));
                self.indent += 1;
                self.line(&format!("{} = {:?}", var, default));
                self.indent -= 1;
                self.line("}");
            }
            self.line(&format!("_ = {}", var));
        }
        Ok(var)
    }

    fn resolve_tweak_args(
        &mut self,
        node: &NodeInstance,
        comp: &ComponentDef,
    ) -> Result<Vec<String>> {
        let mut out = Vec::with_capacity(comp.tweaks.len());
        for t in &comp.tweaks {
            let supplied = node
                .tweak_values
                .get(&t.name)
                .cloned()
                .or_else(|| t.default.clone());
            let val = supplied.ok_or_else(|| {
                anyhow!(
                    "node {}: tweak '{}' has no value and no default",
                    node.id,
                    t.name
                )
            })?;
            out.push(self.render_literal_val(&val, Some(&t.ty))?);
        }
        Ok(out)
    }

    fn render_literal_val(&self, v: &Value, expected: Option<&TypeRef>) -> Result<String> {
        if let (Some(TypeRef::Custom { name }), Value::String(s)) = (expected, v) {
            let variants = lookup_enum_variants(self.wf, self.reg, name);
            if let Some(vs) = variants {
                if !vs.iter().any(|vn| vn == s) {
                    bail!("'{}' is not a variant of enum '{}'", s, name);
                }
                let owner = self.reg.type_owner(name);
                let type_label = pascal(name);
                let const_name = format!("{}{}", type_label, pascal(s));
                return Ok(match owner {
                    Some(m) => format!("{}.{}", m.alias, const_name),
                    None => const_name,
                });
            }
        }
        render_literal(v, expected)
    }

    fn resolve_args(
        &mut self,
        node: &'a NodeInstance,
        comp: &'a ComponentDef,
    ) -> Result<Vec<String>> {
        let mut out = Vec::with_capacity(comp.inputs.len());
        for port in &comp.inputs {
            let expr = self.resolve_port_expr(node, &port.name, Some(&port.ty))?;
            if port.consumption == Some(Consumption::Passthrough) {
                let pt_port = format!("{}__pt", port.name);
                let pt_var = format!("var_{}_{}", sanitize(&node.id), sanitize(&pt_port));
                self.line(&format!("{} := {}", pt_var, expr));
                self.line(&format!("_ = {}", pt_var));
                out.push(pt_var);
            } else {
                out.push(expr);
            }
        }
        Ok(out)
    }

    fn resolve_port_expr(
        &mut self,
        node: &'a NodeInstance,
        port: &str,
        expected: Option<&TypeRef>,
    ) -> Result<String> {
        if let Some((src_id, src_port)) = self
            .data_in
            .get(&(node.id.as_str(), port.to_string()))
            .cloned()
        {
            return self.resolve_source(src_id, &src_port);
        }
        if let Some(lit) = node.literal_inputs.get(port) {
            return render_literal(lit, expected);
        }
        bail!(
            "missing input '{}' on node {} ({}/{}): no wire and no literal",
            port,
            node.id,
            node.module_id,
            node.component
        )
    }

    fn resolve_source(&mut self, src_id: &'a str, src_port: &str) -> Result<String> {
        let node = *self
            .nodes
            .get(src_id)
            .ok_or_else(|| anyhow!("edge references missing node '{src_id}'"))?;

        match node.kind {
            NodeKind::Constant => self.ensure_constant_emitted(node),
            NodeKind::EnvConst => self.emit_env_const(node),
            NodeKind::Branch | NodeKind::Loop => Ok(format!(
                "var_{}_{}",
                sanitize(&node.id),
                sanitize(src_port)
            )),
            NodeKind::Construct => {
                self.ensure_pure_emitted(node)?;
                Ok(format!(
                    "var_{}_{}",
                    sanitize(&node.id),
                    sanitize(DATA_CONSTRUCT_OUT)
                ))
            }
            NodeKind::Destruct => {
                self.ensure_pure_emitted(node)?;
                Ok(format!(
                    "var_{}_{}",
                    sanitize(&node.id),
                    sanitize(src_port)
                ))
            }
            NodeKind::Origin | NodeKind::Exit => {
                bail!("node '{}' has no data outputs", node.id)
            }
            NodeKind::Module => {
                let cat = derived_category(node, self.reg);
                if cat == Some(NodeCategory::Pure) {
                    self.ensure_pure_emitted(node)?;
                } else if !self.emitted_action.contains(&node.id) {
                    bail!(
                        "data dependency '{}.{}' used before its node was executed",
                        node.id,
                        src_port
                    );
                }

                if src_port == DATA_ERRVAL {
                    return self.resolve_errval(node);
                }
                if src_port == DISPATCH_PORT {
                    bail!("__dispatch__ port cannot be a data source for non-trigger nodes");
                }
                Ok(format!(
                    "var_{}_{}",
                    sanitize(&node.id),
                    sanitize(src_port)
                ))
            }
        }
    }

    fn resolve_errval(&self, node: &NodeInstance) -> Result<String> {
        let (module, comp) = self.lookup(node)?;
        let err_ty = comp
            .error_type
            .as_ref()
            .ok_or_else(|| anyhow!("node {}: __errval__ used but no error_type", node.id))?;
        let var = format!("err_{}", sanitize(&node.id));
        match err_ty {
            TypeRef::String => Ok(format!("{}.Error()", var)),
            TypeRef::Custom { name } => {
                let owner = self.reg.type_owner(name).unwrap_or(module);
                Ok(format!("{}.({}.{})", var, owner.alias, pascal(name)))
            }
            _ => Ok(var),
        }
    }

    fn ensure_constant_emitted(&mut self, node: &NodeInstance) -> Result<String> {
        let var = format!("var_{}_value", sanitize(&node.id));
        if self.emitted_constant.insert(node.id.clone()) {
            let ty = node.constant_type.as_ref();
            let val = node.constant_value.clone().unwrap_or(Value::Null);
            if let Some(TypeRef::Custom { name }) = ty {
                if let Some(owner) = self.reg.type_owner(name) {
                    self.register_import(owner);
                }
            }
            let lit = self.render_literal_val(&val, ty)?;
            self.line(&format!("{} := {}", var, lit));
            self.line(&format!("_ = {}", var));
        }
        Ok(var)
    }

    fn ensure_pure_emitted(&mut self, node: &'a NodeInstance) -> Result<()> {
        if !self.emitted_pure.insert(node.id.clone()) {
            return Ok(());
        }
        match node.kind {
            NodeKind::Construct => self.emit_construct(node),
            NodeKind::Destruct => self.emit_destruct(node),
            NodeKind::EnvConst => {
                self.emit_env_const(node)?;
                Ok(())
            }
            NodeKind::Constant => {
                self.ensure_constant_emitted(node)?;
                Ok(())
            }
            _ => {
                let (module, comp) = self.lookup(node)?;
                self.register_import(module);
                let mut args = self.resolve_tweak_args(node, comp)?;
                args.extend(self.resolve_args(node, comp)?);
                self.emit_call(node, module, comp, &args)?;
                self.emitted_action.insert(node.id.clone());
                Ok(())
            }
        }
    }

    fn emit_construct(&mut self, node: &'a NodeInstance) -> Result<()> {
        let name = node
            .target_type
            .as_ref()
            .ok_or_else(|| anyhow!("construct node {} missing target_type", node.id))?;
        let info = resolve_struct_type(self.wf, self.reg, name)?;
        let go_ty = self.struct_go_type(&info, name)?;
        let fields = info.fields();
        let mut parts: Vec<String> = Vec::with_capacity(fields.len());
        for (fname, fty) in &fields {
            let expr = self.resolve_port_expr(node, fname, Some(fty))?;
            parts.push(format!("{}: {}", pascal(fname), expr));
        }
        let var = format!("var_{}_{}", sanitize(&node.id), sanitize(DATA_CONSTRUCT_OUT));
        self.line(&format!(
            "{} := {}{{{}}}",
            var,
            go_ty,
            parts.join(", ")
        ));
        self.line(&format!("_ = {}", var));
        self.emitted_action.insert(node.id.clone());
        Ok(())
    }

    fn emit_destruct(&mut self, node: &'a NodeInstance) -> Result<()> {
        let name = node
            .target_type
            .as_ref()
            .ok_or_else(|| anyhow!("destruct node {} missing target_type", node.id))?;
        let info = resolve_struct_type(self.wf, self.reg, name)?;
        let input_expr = self.resolve_port_expr(
            node,
            DATA_DESTRUCT_IN,
            Some(&TypeRef::Custom { name: name.clone() }),
        )?;
        let tmp = format!("var_{}_{}", sanitize(&node.id), sanitize(DATA_DESTRUCT_IN));
        self.line(&format!("{} := {}", tmp, input_expr));
        self.line(&format!("_ = {}", tmp));
        for (fname, _) in info.fields() {
            let out_var = format!("var_{}_{}", sanitize(&node.id), sanitize(fname));
            self.line(&format!("{} := {}.{}", out_var, tmp, pascal(fname)));
            self.line(&format!("_ = {}", out_var));
        }
        self.emitted_action.insert(node.id.clone());
        Ok(())
    }

    fn struct_go_type(&mut self, info: &StructInfo<'a>, name: &str) -> Result<String> {
        match info {
            StructInfo::Module(_td) => {
                if let Some(owner) = self.reg.type_owner(name) {
                    self.register_import(owner);
                    Ok(format!("{}.{}", owner.alias, pascal(name)))
                } else {
                    bail!("cannot locate module for type '{}'", name)
                }
            }
            StructInfo::Workflow(_) => Ok(pascal(name)),
        }
    }

    fn register_import(&mut self, module: &'a ModuleManifest) {
        self.imports.insert(module.alias.clone(), module);
    }

    fn go_type(&self, t: &TypeRef) -> Result<String> {
        Ok(match t {
            TypeRef::Int => "int64".to_string(),
            TypeRef::Float => "float64".to_string(),
            TypeRef::String => "string".to_string(),
            TypeRef::Bool => "bool".to_string(),
            TypeRef::Any => "any".to_string(),
            TypeRef::Array { of } => format!("[]{}", self.go_type(of)?),
            TypeRef::Dict { value } => format!("map[string]{}", self.go_type(value)?),
            TypeRef::Custom { name } => {
                if let Some(owner) = self.reg.type_owner(name) {
                    format!("{}.{}", owner.alias, pascal(name))
                } else if self.wf.custom_types.iter().any(|t| t.name == *name) {
                    pascal(name)
                } else {
                    bail!("unknown custom type '{}'", name)
                }
            }
        })
    }

    fn line(&mut self, s: &str) {
        for _ in 0..self.indent {
            self.body.push('\t');
        }
        self.body.push_str(s);
        self.body.push('\n');
    }

    fn finalize(self, plan: BuildPlan) -> GoFile {
        let mut out = String::new();
        out.push_str("package main\n\n");

        let mut imports_map: BTreeMap<String, String> = BTreeMap::new();
        if self.uses_fmt {
            imports_map.insert("fmt".to_string(), "fmt".to_string());
        }
        if self.uses_os {
            imports_map.insert("os".to_string(), "os".to_string());
        }
        for (alias, mm) in &self.imports {
            imports_map.insert(alias.clone(), mm.import_path.clone());
        }

        out.push_str("import (\n");
        for (alias, path) in &imports_map {
            if alias == "fmt" {
                out.push_str("\t\"fmt\"\n");
            } else if alias == "os" {
                out.push_str("\t\"os\"\n");
            } else {
                out.push_str(&format!("\t{} \"{}\"\n", alias, path));
            }
        }
        out.push_str(")\n\n");

        writeln!(
            out,
            "// workflow: {} ({})\n// version: {} — generated by automato compiler",
            self.wf.name, self.wf.id, self.wf.version
        )
        .ok();
        out.push('\n');

        for ct in &self.wf.custom_types {
            out.push_str(&emit_custom_type(self.reg, ct));
            out.push('\n');
        }

        for tfn in &self.trigger_fns {
            let params_str: Vec<String> = tfn
                .params
                .iter()
                .map(|(n, t)| format!("{} {}", n, t))
                .collect();
            out.push_str(&format!(
                "func {}({}) {{\n",
                tfn.name,
                params_str.join(", ")
            ));
            for (n, _) in &tfn.params {
                out.push_str(&format!("\t_ = {}\n", n));
            }
            out.push_str(&tfn.body);
            out.push_str("}\n\n");
        }

        match plan {
            BuildPlan::DispatchRooted => {
                out.push_str("func OriginEntry() {\n");
                out.push_str(&self.body);
                out.push_str("}\n\n");

                out.push_str("func main() {\n");
                out.push_str("\tOriginEntry()\n");
                out.push_str("}\n");
            }
            BuildPlan::Legacy(plan) => {
                let params_str: Vec<String> = plan
                    .workflow_params
                    .iter()
                    .map(|(n, t)| format!("{} {}", n, t))
                    .collect();
                out.push_str(&format!(
                    "func WorkflowEntry({}) {{\n",
                    params_str.join(", ")
                ));
                for (n, _) in &plan.workflow_params {
                    out.push_str(&format!("\t_ = {}\n", n));
                }
                out.push_str(&self.body);
                out.push_str("}\n\n");

                out.push_str("func main() {\n");
                let arg_names: Vec<String> = (0..plan.trigger_output_count)
                    .map(|i| format!("v{}", i))
                    .collect();
                let mut trigger_call_args = plan.trigger_tweak_args.clone();
                match plan.trigger_style {
                    TriggerStyle::Callback => {
                        trigger_call_args.push("WorkflowEntry".to_string());
                        out.push_str(&format!(
                            "\t{}.{}({})\n",
                            plan.trigger_alias,
                            plan.trigger_fn,
                            trigger_call_args.join(", ")
                        ));
                    }
                    TriggerStyle::Polling => {
                        out.push_str("\tfor {\n");
                        let call = format!(
                            "{}.{}({})",
                            plan.trigger_alias,
                            plan.trigger_fn,
                            trigger_call_args.join(", ")
                        );
                        if arg_names.is_empty() {
                            out.push_str(&format!("\t\tok := {}\n", call));
                        } else {
                            out.push_str(&format!(
                                "\t\t{}, ok := {}\n",
                                arg_names.join(", "),
                                call
                            ));
                        }
                        out.push_str("\t\tif !ok {\n\t\t\tcontinue\n\t\t}\n");
                        out.push_str(&format!(
                            "\t\tWorkflowEntry({})\n",
                            arg_names.join(", ")
                        ));
                        out.push_str("\t}\n");
                    }
                }
                out.push_str("}\n");
            }
        }

        let mut imports = imports_map;
        imports.remove("fmt");
        if self.uses_fmt {
            imports.insert("fmt".to_string(), "fmt".to_string());
        }
        if self.uses_os {
            imports.insert("os".to_string(), "os".to_string());
        }
        GoFile {
            body: out,
            imports,
        }
    }
}

fn emit_custom_type(reg: &Registry, ct: &CustomType) -> String {
    let mut s = String::new();
    match ct.kind {
        CustomTypeKind::Enum => {
            let ty = pascal(&ct.name);
            writeln!(s, "type {} string", ty).ok();
            if !ct.variants.is_empty() {
                s.push_str("const (\n");
                for v in &ct.variants {
                    writeln!(s, "\t{}{} {} = {:?}", ty, pascal(v), ty, v).ok();
                }
                s.push_str(")\n");
            }
            writeln!(s, "func (x {}) String() string {{ return string(x) }}", ty).ok();
        }
        CustomTypeKind::Struct => {
            writeln!(s, "type {} struct {{", pascal(&ct.name)).ok();
            for f in &ct.fields {
                writeln!(s, "\t{} {}", pascal(&f.name), type_to_go(reg, &f.ty)).ok();
            }
            s.push_str("}\n");
        }
    }
    s
}

fn type_to_go(reg: &Registry, t: &TypeRef) -> String {
    match t {
        TypeRef::Int => "int64".to_string(),
        TypeRef::Float => "float64".to_string(),
        TypeRef::String => "string".to_string(),
        TypeRef::Bool => "bool".to_string(),
        TypeRef::Any => "any".to_string(),
        TypeRef::Array { of } => format!("[]{}", type_to_go(reg, of)),
        TypeRef::Dict { value } => format!("map[string]{}", type_to_go(reg, value)),
        TypeRef::Custom { name } => match reg.type_owner(name) {
            Some(owner) => format!("{}.{}", owner.alias, pascal(name)),
            None => pascal(name),
        },
    }
}

fn render_literal(v: &Value, expected: Option<&TypeRef>) -> Result<String> {
    match (v, expected) {
        (Value::Null, _) => Ok("nil".to_string()),
        (Value::Bool(b), _) => Ok(b.to_string()),
        (Value::Number(n), Some(TypeRef::Int)) => {
            let i = n
                .as_i64()
                .ok_or_else(|| anyhow!("expected int literal, got {}", n))?;
            Ok(format!("int64({})", i))
        }
        (Value::Number(n), Some(TypeRef::Float)) => {
            let f = n
                .as_f64()
                .ok_or_else(|| anyhow!("expected float literal, got {}", n))?;
            Ok(format!("float64({})", f))
        }
        (Value::Number(n), _) => {
            if let Some(i) = n.as_i64() {
                Ok(format!("int64({})", i))
            } else if let Some(f) = n.as_f64() {
                Ok(format!("float64({})", f))
            } else {
                Ok(n.to_string())
            }
        }
        (Value::String(s), _) => Ok(format!("{:?}", s)),
        (Value::Array(a), _) => {
            let inner_expected = match expected {
                Some(TypeRef::Array { of }) => Some(of.as_ref()),
                _ => None,
            };
            let parts: Result<Vec<String>> = a
                .iter()
                .map(|v| render_literal(v, inner_expected))
                .collect();
            let elem_ty = match expected {
                Some(TypeRef::Array { of }) => go_type_static(of),
                _ => "any".to_string(),
            };
            Ok(format!("[]{}{{{}}}", elem_ty, parts?.join(", ")))
        }
        (Value::Object(o), _) => {
            let value_expected = match expected {
                Some(TypeRef::Dict { value }) => Some(value.as_ref()),
                _ => None,
            };
            let parts: Result<Vec<String>> = o
                .iter()
                .map(|(k, v)| {
                    let rendered = render_literal(v, value_expected)?;
                    Ok(format!("{:?}: {}", k, rendered))
                })
                .collect();
            let val_ty = match expected {
                Some(TypeRef::Dict { value }) => go_type_static(value),
                _ => "any".to_string(),
            };
            Ok(format!("map[string]{}{{{}}}", val_ty, parts?.join(", ")))
        }
    }
}

fn go_type_static(t: &TypeRef) -> String {
    match t {
        TypeRef::Int => "int64".to_string(),
        TypeRef::Float => "float64".to_string(),
        TypeRef::String => "string".to_string(),
        TypeRef::Bool => "bool".to_string(),
        TypeRef::Any => "any".to_string(),
        TypeRef::Array { of } => format!("[]{}", go_type_static(of)),
        TypeRef::Dict { value } => format!("map[string]{}", go_type_static(value)),
        TypeRef::Custom { name } => pascal(name),
    }
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

fn pascal(s: &str) -> String {
    let mut out = String::new();
    let mut up = true;
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            if up {
                out.extend(c.to_uppercase());
                up = false;
            } else {
                out.push(c);
            }
        } else {
            up = true;
        }
    }
    if out.is_empty() {
        out.push('T');
    }
    out
}
