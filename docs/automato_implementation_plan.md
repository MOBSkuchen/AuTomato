Node rework:

- The types "return" and "trigger" are supposed to be TYPES not specific nodes.
Currently, there is a node "Trigger" and a node "Return", but I want to change it so that
a node like HttpRequest is a trigger node.
The concept behind this is that the workflow compiles to a routine which checks for an event defined for
this trigger node and then calls the function representing the rest of the workflow.
Thus, this node takes no input as it is the very beginning of state and it gives outputs, which
are the arguments it gives to the workflow function.



This means that the return node effectively compiles to this:

"return RETURN_NODE_FUNCTION(...inputs...)"

- Introduce logic nodes:
  - branches (if statements)
  - loops

  These nodes are their own types like for example return nodes

- Introduce a way to call a function / node with no inputs

- Introduce a way to chain multiple inputs to multiple nodes.
Currently every output of a node goes to exactly one input.
However, we may want to log a string and then give it to another function.
This also requires a way to regulate execution order for nodes.

Concept for control flow:

A specific control flow connection.
This is a connection which regulates what nodes to execute. It originated in a trigger node and is terminated in a
return node. It can only be split on nodes which return one of X different things.
This fixes the function with no input problem too.
Connecting this control flow connection to a node requires that all nodes which it gets its inputs from have been called
before it.

Concept for multiple nodes with the same input data.
There are two kinds of inputs. A passthrough value and a consumed value.
A consumed value is given as an input and is consumed by the function / node.
A passthrough value is given as an input and then returned again.



This can be imagined like a Rust function. A passthrough value is a borrow and a
consumed value is the literal instance / value.


---

### Part 1: Evaluation of Ideas & Industry Context

#### 1. Triggers and Returns as "Types"
*   **Industry Context:** Systems like **n8n**, **Zapier**, and **AWS Step Functions** use this pattern. A workflow doesn't start in a vacuum; it starts from a specific event context (e.g., `Webhook` or `CronSchedule`).
*   **Evaluation:** **Brilliant.** Because your end product is a Go binary, the Trigger node dictates the scaffolding. An `HttpRequest` trigger tells your compiler to generate an `http.HandleFunc` that extracts the payload and passes it into the workflow. The `Return` node cleanly maps to the Go function's return signature `return payload, nil`.

#### 2. Logic Nodes & Explicit Control Flow Connections
*   **Industry Context:** **Unreal Engine Blueprints** define the gold standard here. They use white "Execution Pins" to dictate *when* something runs, and colored "Data Pins" to dictate *what* it processes.
*   **Evaluation:** **Solves your hardest engine problems.** Pure data-flow graphs struggle with side-effects and zero-input functions (e.g., `Log("Hello")` or `GetSystemTime()`). If two nodes don't share data, how does the compiler know which executes first? Control flow connections explicitly fix this. Furthermore, logic nodes like `Branch` simply split the control wire into `True`/`False` paths, which trivially compiles to Go `if/else` blocks.

#### 3. Chaining Multiple Inputs (1-to-N Data Routing)
*   **Industry Context:** Almost all modern node editors allow 1-to-N data routing, but without explicit execution flow, it creates race conditions.
*   **Evaluation:** **Essential for usability.** Because your new Control Flow explicitly orders execution, data routing becomes perfectly safe. In the compiled Go code, this simply means assigning the output to a variable (`user := FetchUser()`) and passing that variable to subsequent functions (`Log(user); Save(user)`).

#### 4. Consumed vs. Passthrough Values (The Visual Borrow Checker)
*   **Industry Context:** Most tools silently clone data, leading to visual spaghetti. **LabVIEW** uses a similar concept for hardware resources, but applying this to software is uniquely aligned with **Rust's affine types (Borrow/Move)**.
*   **Evaluation:** **Highly innovative.** It maps beautifully to Go's resource handling (e.g., reading an `io.ReadCloser` body *consumes* it, but a parsed `string` can be *passed through*).
  *   **Consumed (Move):** The UI enforces that a consumed output strictly claims the connection; it cannot be wired to any other node.
  *   **Passthrough (Borrow):** A node reads the data and explicitly provides a matching output handle, allowing the user to "chain" nodes sequentially (like the Builder pattern).

---

### Part 2: Step-by-Step Implementation Plan

To implement this paradigm shift without breaking your current MVP, follow this phased approach across your stack.

#### Phase 1: Update the Module Schema (`definitions.json` & AST)
You must formally establish the vocabulary for Control Flow and Data Flow.

1.  **Node Categories:** Update the module definitions to include a `category`:
  *   `trigger` (0 Exec In, 1 Exec Out)
  *   `action` / effectful (1 Exec In, 1 Exec Out)
  *   `pure` (0 Exec Pins — lazily evaluated data nodes like String Concat)
  *   `logic` (1 Exec In, N Exec Outs)
  *   `return` (1 Exec In, 0 Exec Out)
2.  **Edge Types:** Update the shared Rust/TS AST `Edge` to differentiate between `type: 'data'` and `type: 'exec'`.
3.  **Data Consumption:** Add a `"consumption": "consumed" | "passthrough"` tag to module input arguments.

#### Phase 2: Frontend Editor Overhaul (React Flow)
The visual editor must treat `exec` connections entirely differently from `data` connections.

1.  **Visual Distinction (`ModuleNode.tsx`):** Render `exec` handles distinctly. The standard UX is chevron/triangle arrows at the top and bottom of nodes for Execution flow, and circles on the sides for Data flow.
2.  **Connection Rules (`typecheck.ts`):**
  *   `exec` handles can **only** connect to `exec` handles.
  *   `exec` outputs are strictly **1-to-1** (you cannot fork execution without an explicit `Branch` node).
  *   `data` outputs can be **1-to-N**, *unless* the target input is marked as `consumed`. If consumed, block any further connections from that data source.
3.  **Auto-Passthrough UI:** If a module defines an input as `passthrough`, the frontend should dynamically render a matching Data Output handle so the user can visually chain it.
4.  **Error Branches as Control Flow:** Your existing `__error__` ports beautifully translate to this new model! An error port is no longer a data port; it is simply an **alternative Execution Out path**.

#### Phase 3: Compiler Stage 1 (AST Traversal in Rust)
Currently, your Rust compiler likely uses a topological sort based on data dependencies. You must rewrite this to **walk the execution tree**.

1.  **Execution Traversal:** Start at the `Trigger` node and walk forward along the `exec` edges. Every visited node becomes a sequential step in the compilation array.
2.  **Lazy Data Resolution (Look-behind):** When the compiler visits an `action` node via the execution line, it checks its data inputs.
  *   If the data comes from a `pure` node, it traverses backwards up the data wire to evaluate/inline that pure node's expression.
  *   If the data comes from another `action` node, it verifies that the source node was *already executed* previously in the control flow. If not, throw a compile error ("Data dependency used before execution").

#### Phase 4: Compiler Stage 2 (Lowering to Go)
Update the Go code generation to map the Execution AST into standard Go control structures.

1.  **Trigger Wrappers:** The compiler reads the Trigger node and generates the boilerplate context.
    ```go
    func HandleRequest(req HTTPRequest) (HTTPResponse, error) { ... }
    ```
2.  **Sequential Statements:** As you walk the execution flow, emit Go lines. Assign outputs to uniquely named variables so downstream nodes can use them.
    ```go
    res_node2, err_node2 := modules.PerformAction(...)
    ```
3.  **Logic Node Lowering:**
  *   `Branch` nodes compile directly to Go `if / else` blocks. You generate the `if`, walk the True execution path, close the block, and walk the False execution path.
  *   `Loop` nodes compile to `for _, item := range arrayData { ... }`.
4.  **Error Flow:** A node returning a `Result` simply branches the code based on the execution wires.
    ```go
    if err_node2 != nil {
        // ... code generated by following the __error__ execution wire
    }
    // ... code generated by following the success execution wire
    ```

By adopting this model, the visual graph stops acting as an abstract state machine and becomes a literal visual representation of the generated Go AST.

---

### Status (2026-04-21)

- **Phase 1 + 2:** shipped (see frontend).
- **Phase 3:** `compiler/src/emit.rs` walks exec edges from the trigger, lazily resolves `pure` data inputs, and rejects action→action data deps whose source hasn't already executed.
- **Phase 4:** single-file Go emission. `runWorkflow()` contains the exec walk; branch → `if/else`, loop → `for range`, return → stub call + `return`; error-bearing actions fan to the `__err__` exec path. Module calls are emitted as typed stub funcs the user fills in. `go-project` target returns `main.go` contents; zip/multi-file output and real module-source resolution are deferred.
- **UI:** `Compile` POSTs to `POST /compile` on the backend (default `http://localhost:7878`, override with `VITE_BACKEND_URL`) and downloads the returned `main.go`.
