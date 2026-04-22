import type { ModuleDef, CustomTypeDef } from "./types";

const httpRequestType: CustomTypeDef = {
  name: "HTTPRequest",
  fields: [
    { name: "url", type: { kind: "string" } },
    { name: "method", type: { kind: "string" } },
    { name: "body", type: { kind: "string" } },
  ],
  sourceModule: "automato/http-request",
};

const httpErrorType: CustomTypeDef = {
  name: "HTTPError",
  fields: [
    { name: "code", type: { kind: "int" } },
    { name: "message", type: { kind: "string" } },
  ],
  sourceModule: "automato/http-request",
};

const emailType: CustomTypeDef = {
  name: "Email",
  fields: [
    { name: "subject", type: { kind: "string" } },
    { name: "sender", type: { kind: "string" } },
    { name: "body", type: { kind: "string" } },
  ],
  sourceModule: "automato/gmail",
};

const jsonParseErrorType: CustomTypeDef = {
  name: "JSONParseError",
  fields: [{ name: "message", type: { kind: "string" } }],
  sourceModule: "automato/json-parse",
};

export const BUILTIN_TYPES: CustomTypeDef[] = [
  httpRequestType,
  httpErrorType,
  emailType,
  jsonParseErrorType,
];

export const MODULES: ModuleDef[] = [
  {
    id: "automato/webhook",
    name: "Webhook",
    version: "0.1.0",
    description: "HTTP trigger: fires when a request hits the configured path.",
    author: "AuTomato",
    category: "Triggers",
    effectTags: ["reads_external_state"],
    exportedTypes: [],
    components: [
      {
        name: "on_request",
        description: "Fires on every inbound HTTP request.",
        category: "trigger",
        inputs: [],
        outputs: [
          { name: "request", type: { kind: "custom", name: "HTTPRequest" } },
        ],
      },
    ],
    docs: "Workflow entry point. Compiles to an http.HandleFunc.",
    sourceUrl: "registry://automato/webhook@0.1.0",
  },
  {
    id: "automato/cron",
    name: "Cron",
    version: "0.1.0",
    description: "Timer trigger that fires on a cron schedule.",
    author: "AuTomato",
    category: "Triggers",
    effectTags: [],
    exportedTypes: [],
    components: [
      {
        name: "on_tick",
        description: "Fires at each scheduled tick.",
        category: "trigger",
        inputs: [],
        outputs: [{ name: "fired_at", type: { kind: "string" } }],
      },
    ],
    docs: "Compiles to a goroutine driven by a time.Ticker.",
    sourceUrl: "registry://automato/cron@0.1.0",
  },
  {
    id: "automato/return",
    name: "Return",
    version: "0.1.0",
    description: "Workflow terminator. Shape depends on the trigger.",
    author: "AuTomato",
    category: "Returns",
    effectTags: [],
    exportedTypes: [],
    components: [
      {
        name: "http_response",
        description: "Return an HTTP response to the caller.",
        category: "return",
        inputs: [
          { name: "status", type: { kind: "int" } },
          { name: "body", type: { kind: "string" }, consumption: "consumed" },
        ],
        outputs: [],
      },
      {
        name: "ok",
        description: "Terminate the workflow without a return payload.",
        category: "return",
        inputs: [],
        outputs: [],
      },
    ],
    docs: "Compiles to `return <args>`.",
    sourceUrl: "registry://automato/return@0.1.0",
  },
  {
    id: "automato/http-request",
    name: "HTTP Request",
    version: "0.1.0",
    description: "Perform an HTTP request and return the response body.",
    author: "AuTomato",
    category: "Network",
    effectTags: ["reads_external_state", "retry", "expensive"],
    exportedTypes: [httpRequestType, httpErrorType],
    components: [
      {
        name: "fetch",
        description: "Fetch a URL and return the body.",
        category: "action",
        inputs: [
          {
            name: "request",
            type: { kind: "custom", name: "HTTPRequest" },
            consumption: "consumed",
          },
        ],
        outputs: [
          { name: "body", type: { kind: "string" } },
          { name: "status", type: { kind: "int" } },
        ],
        errorType: { kind: "custom", name: "HTTPError" },
      },
    ],
    docs: "Fetch the body of an HTTP URL. Default method is GET.",
    sourceUrl: "registry://automato/http-request@0.1.0",
  },
  {
    id: "automato/json-parse",
    name: "JSON Parse",
    version: "0.1.0",
    description: "Parse a JSON string into a string-keyed dict.",
    author: "AuTomato",
    category: "Transform",
    effectTags: ["pure"],
    exportedTypes: [jsonParseErrorType],
    components: [
      {
        name: "parse",
        description: "Parse a JSON string. Non-string leaves are stringified.",
        category: "pure",
        inputs: [
          { name: "input", type: { kind: "string" }, consumption: "passthrough" },
        ],
        outputs: [
          { name: "value", type: { kind: "dict", value: { kind: "string" } } },
        ],
        errorType: { kind: "custom", name: "JSONParseError" },
      },
    ],
    docs: "Parses JSON into a dict<string>. Malformed input produces JSONParseError.",
    sourceUrl: "registry://automato/json-parse@0.1.0",
  },
  {
    id: "automato/log",
    name: "Log",
    version: "0.1.0",
    description: "Print a string to stdout.",
    author: "AuTomato",
    category: "Debug",
    effectTags: ["writes_external_state"],
    exportedTypes: [],
    components: [
      {
        name: "info",
        description: "Log a string at info level.",
        category: "action",
        inputs: [
          { name: "message", type: { kind: "string" }, consumption: "passthrough" },
        ],
        outputs: [],
      },
    ],
    docs: "Side-effecting sink. Passes its message through for chaining.",
    sourceUrl: "registry://automato/log@0.1.0",
  },
  {
    id: "automato/string",
    name: "String",
    version: "0.1.0",
    description: "String construction and manipulation.",
    author: "AuTomato",
    category: "Transform",
    effectTags: ["pure"],
    exportedTypes: [],
    components: [
      {
        name: "concat",
        description: "Concatenate two strings.",
        category: "pure",
        inputs: [
          { name: "a", type: { kind: "string" } },
          { name: "b", type: { kind: "string" } },
        ],
        outputs: [{ name: "out", type: { kind: "string" } }],
      },
      {
        name: "from_int",
        description: "Format an int as a decimal string.",
        category: "pure",
        inputs: [{ name: "n", type: { kind: "int" } }],
        outputs: [{ name: "out", type: { kind: "string" } }],
      },
    ],
    docs: "Pure string helpers.",
    sourceUrl: "registry://automato/string@0.1.0",
  },
  {
    id: "automato/http-request-build",
    name: "HTTP Request Builder",
    version: "0.1.0",
    description: "Build an HTTPRequest record from primitives.",
    author: "AuTomato",
    category: "Network",
    effectTags: ["pure"],
    exportedTypes: [],
    components: [
      {
        name: "build",
        description: "Construct an HTTPRequest.",
        category: "pure",
        inputs: [
          { name: "url", type: { kind: "string" } },
          { name: "method", type: { kind: "string" } },
          { name: "body", type: { kind: "string" } },
        ],
        outputs: [
          { name: "request", type: { kind: "custom", name: "HTTPRequest" } },
        ],
      },
    ],
    docs: "Constructs an HTTPRequest from url + method + body.",
    sourceUrl: "registry://automato/http-request-build@0.1.0",
  },
  {
    id: "automato/gmail",
    name: "Gmail",
    version: "0.1.0",
    description: "Send an email via Gmail.",
    author: "AuTomato",
    category: "Integrations",
    effectTags: ["writes_external_state", "retry", "expensive"],
    exportedTypes: [emailType],
    components: [
      {
        name: "send",
        description: "Send an email.",
        category: "action",
        inputs: [
          {
            name: "email",
            type: { kind: "custom", name: "Email" },
            consumption: "consumed",
          },
        ],
        outputs: [{ name: "message_id", type: { kind: "string" } }],
        errorType: { kind: "string" },
      },
    ],
    docs: "Sends an email using the configured Gmail credentials.",
    sourceUrl: "registry://automato/gmail@0.1.0",
  },
];

export function findModule(id: string): ModuleDef | undefined {
  return MODULES.find((m) => m.id === id);
}

export function findComponent(moduleId: string, componentName: string) {
  const m = findModule(moduleId);
  if (!m) return undefined;
  return m.components.find((c) => c.name === componentName);
}

export function allKnownCustomTypes(): CustomTypeDef[] {
  const seen = new Set<string>();
  const out: CustomTypeDef[] = [];
  for (const m of MODULES) {
    for (const t of m.exportedTypes) {
      if (!seen.has(t.name)) {
        seen.add(t.name);
        out.push(t);
      }
    }
  }
  return out;
}
