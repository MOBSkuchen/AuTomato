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

const httpMethodEnum: CustomTypeDef = {
  name: "HTTPMethod",
  kind: "enum",
  fields: [],
  variants: ["GET", "POST", "PUT", "DELETE", "PATCH", "ANY"],
  sourceModule: "automato/webhook",
};

const httpRequestContextType: CustomTypeDef = {
  name: "HTTPRequestContext",
  kind: "struct",
  fields: [],
  sealed: true,
  sourceModule: "automato/webhook",
};

const gmailClientType: CustomTypeDef = {
  name: "GmailClient",
  kind: "struct",
  fields: [],
  sealed: true,
  sourceModule: "automato/gmail",
};

const logLevelEnum: CustomTypeDef = {
  name: "LogLevel",
  kind: "enum",
  fields: [],
  variants: ["DEBUG", "INFO", "WARN", "ERROR"],
  sourceModule: "automato/log",
};

const cronUnitEnum: CustomTypeDef = {
  name: "CronUnit",
  kind: "enum",
  fields: [],
  variants: ["ms", "s", "m", "h"],
  sourceModule: "automato/cron",
};

export const BUILTIN_TYPES: CustomTypeDef[] = [
  httpRequestType,
  httpErrorType,
  emailType,
  jsonParseErrorType,
  httpMethodEnum,
  httpRequestContextType,
  gmailClientType,
  logLevelEnum,
  cronUnitEnum,
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
    exportedTypes: [httpMethodEnum, httpRequestContextType],
    components: [
      {
        name: "on_request",
        description:
          "Listens on the configured address/path/method; emits the request and a sealed response context.",
        category: "trigger",
        inputs: [],
        outputs: [
          { name: "request", type: { kind: "custom", name: "HTTPRequest" } },
          { name: "ctx", type: { kind: "custom", name: "HTTPRequestContext" } },
        ],
        tweaks: [
          {
            name: "address",
            description: "Host:port the server binds to.",
            type: { kind: "string" },
            default: ":8080",
          },
          {
            name: "path",
            description: "URL path to register the handler on.",
            type: { kind: "string" },
            default: "/",
          },
          {
            name: "method",
            description: "Accepted HTTP method (ANY matches all).",
            type: { kind: "custom", name: "HTTPMethod" },
            default: "ANY",
          },
        ],
      },
      {
        name: "respond",
        description:
          "Writes an HTTP response for the given request context, then ends the workflow.",
        category: "return",
        inputs: [
          {
            name: "ctx",
            type: { kind: "custom", name: "HTTPRequestContext" },
            consumption: "consumed",
          },
          { name: "status", type: { kind: "int" } },
          { name: "body", type: { kind: "string" }, consumption: "consumed" },
        ],
        outputs: [],
        tweaks: [
          {
            name: "content_type",
            description: "Content-Type header value.",
            type: { kind: "string" },
            default: "text/plain; charset=utf-8",
          },
        ],
      },
      {
        name: "respond_json",
        description:
          "Writes a JSON response (Content-Type application/json) and ends the workflow.",
        category: "return",
        inputs: [
          {
            name: "ctx",
            type: { kind: "custom", name: "HTTPRequestContext" },
            consumption: "consumed",
          },
          { name: "status", type: { kind: "int" } },
          { name: "body", type: { kind: "string" }, consumption: "consumed" },
        ],
        outputs: [],
      },
    ],
    docs: "Compiles to an http.HandleFunc server. Pair on_request with respond in the same workflow.",
    sourceUrl: "registry://automato/webhook@0.2.0",
  },
  {
    id: "automato/cron",
    name: "Cron",
    version: "0.2.0",
    description: "Timer trigger that fires on a configurable interval.",
    author: "AuTomato",
    category: "Triggers",
    effectTags: [],
    exportedTypes: [cronUnitEnum],
    components: [
      {
        name: "on_tick",
        description: "Fires at each scheduled tick.",
        category: "trigger",
        inputs: [],
        outputs: [{ name: "fired_at", type: { kind: "string" } }],
        tweaks: [
          {
            name: "interval",
            description: "Interval value (combined with unit).",
            type: { kind: "int" },
            default: 1,
          },
          {
            name: "unit",
            description: "Time unit for the interval.",
            type: { kind: "custom", name: "CronUnit" },
            default: "s",
          },
        ],
      },
    ],
    docs: "Compiles to a time.Sleep loop. Configure interval+unit via tweaks.",
    sourceUrl: "registry://automato/cron@0.2.0",
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
        description: "Perform an HTTP request and return the response body + status.",
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
        tweaks: [
          {
            name: "timeout_ms",
            description: "Per-request timeout in milliseconds.",
            type: { kind: "int" },
            default: 30000,
          },
          {
            name: "user_agent",
            description: "User-Agent header value.",
            type: { kind: "string" },
            default: "AuTomato/0.2",
          },
          {
            name: "follow_redirects",
            description: "Follow 3xx redirects automatically.",
            type: { kind: "bool" },
            default: true,
          },
        ],
      },
    ],
    docs: "Fetch the body of an HTTP URL. Method comes from the HTTPRequest input.",
    sourceUrl: "registry://automato/http-request@0.2.0",
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
    exportedTypes: [logLevelEnum],
    components: [
      {
        name: "log",
        description: "Log a message at the configured level.",
        category: "action",
        inputs: [
          { name: "message", type: { kind: "string" }, consumption: "passthrough" },
        ],
        outputs: [],
        tweaks: [
          {
            name: "level",
            description: "Severity of the log entry.",
            type: { kind: "custom", name: "LogLevel" },
            default: "INFO",
          },
          {
            name: "prefix",
            description: "Prefix prepended to every message.",
            type: { kind: "string" },
            default: "",
          },
        ],
      },
    ],
    docs: "Side-effecting sink. Passes its message through for chaining.",
    sourceUrl: "registry://automato/log@0.2.0",
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
    exportedTypes: [emailType, gmailClientType],
    components: [
      {
        name: "connect",
        description:
          "Initialise a Gmail client from credentials. Emits a sealed handle used by send.",
        category: "pure",
        inputs: [],
        outputs: [
          { name: "client", type: { kind: "custom", name: "GmailClient" } },
        ],
        tweaks: [
          {
            name: "credentials_path",
            description: "Path to the Gmail OAuth credentials JSON.",
            type: { kind: "string" },
            default: "./gmail.credentials.json",
          },
          {
            name: "from_address",
            description: "Default sender address.",
            type: { kind: "string" },
            default: "",
          },
        ],
      },
      {
        name: "send",
        description: "Send an email through the given client.",
        category: "action",
        inputs: [
          { name: "client", type: { kind: "custom", name: "GmailClient" } },
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
    docs: "Connect once, send many. Client handle is sealed — only produced by connect.",
    sourceUrl: "registry://automato/gmail@0.2.0",
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
  for (const t of BUILTIN_TYPES) {
    if (!seen.has(t.name)) {
      seen.add(t.name);
      out.push(t);
    }
  }
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

export function findCustomType(name: string): CustomTypeDef | undefined {
  return allKnownCustomTypes().find((t) => t.name === name);
}
