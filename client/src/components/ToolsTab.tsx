import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DynamicJsonForm, { DynamicJsonFormRef } from "./DynamicJsonForm";
import type { JsonValue, JsonSchemaType } from "@/utils/jsonUtils";
import {
  generateDefaultValue,
  isPropertyRequired,
  normalizeUnionType,
} from "@/utils/schemaUtils";
import {
  CompatibilityCallToolResult,
  ListToolsResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  Loader2,
  Send,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Copy,
  CheckCheck,
} from "lucide-react";
import { useEffect, useState, useRef } from "react";
import ListPane from "./ListPane";
import JsonView from "./JsonView";
import ToolResults from "./ToolResults";
import { useToast } from "@/lib/hooks/useToast";
import useCopy from "@/lib/hooks/useCopy";
// Type guard to safely detect the optional _meta field without using `any`
const hasMeta = (tool: Tool): tool is Tool & { _meta: unknown } =>
  typeof (tool as { _meta?: unknown })._meta !== "undefined";

const ToolsTab = ({
  tools,
  listTools,
  clearTools,
  callTool,
  selectedTool,
  setSelectedTool,
  toolResult,
  nextCursor,
  error,
  resourceContent,
  onReadResource,
}: {
  tools: Tool[];
  listTools: () => void;
  clearTools: () => void;
  callTool: (name: string, params: Record<string, unknown>) => Promise<void>;
  selectedTool: Tool | null;
  setSelectedTool: (tool: Tool | null) => void;
  toolResult: CompatibilityCallToolResult | null;
  nextCursor: ListToolsResult["nextCursor"];
  error: string | null;
  resourceContent: Record<string, string>;
  onReadResource?: (uri: string) => void;
}) => {
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [isToolRunning, setIsToolRunning] = useState(false);
  const [isOutputSchemaExpanded, setIsOutputSchemaExpanded] = useState(false);
  const [isMetaExpanded, setIsMetaExpanded] = useState(false);
  const [hasValidationErrors, setHasValidationErrors] = useState(false);
  const formRefs = useRef<Record<string, DynamicJsonFormRef | null>>({});
  const { toast } = useToast();
  const { copied, setCopied } = useCopy();

  // Function to check if any form has validation errors
  const checkValidationErrors = () => {
    const errors = Object.values(formRefs.current).some(
      (ref) => ref && !ref.validateJson().isValid,
    );
    setHasValidationErrors(errors);
    return errors;
  };

  useEffect(() => {
    const params = Object.entries(
      selectedTool?.inputSchema.properties ?? [],
    ).map(([key, value]) => [
      key,
      generateDefaultValue(
        value as JsonSchemaType,
        key,
        selectedTool?.inputSchema as JsonSchemaType,
      ),
    ]);
    setParams(Object.fromEntries(params));

    // Reset validation errors when switching tools
    setHasValidationErrors(false);

    // Clear form refs for the previous tool
    formRefs.current = {};
  }, [selectedTool]);

  function uuidv4() {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
      (
        +c ^
        (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))
      ).toString(16),
    );
  }

  // Cookie helpers: simple, path=/, expires in 365 days
  function setCookie(name: string, value: string, days = 365) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
  }

  function getCookie(name: string) {
    return document.cookie
      .split(";")
      .map((c) => c.trim())
      .reduce(
        (acc: string | null, cur) => {
          if (cur.startsWith(`${name}=`))
            return decodeURIComponent(cur.substring(name.length + 1));
          return acc;
        },
        null as string | null,
      );
  }

  // History helpers (persisted in localStorage) per-field
  function getHistory(name: string): string[] {
    try {
      const raw = localStorage.getItem(`inspector_uuid_history_${name}`);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch (e) {
      console.debug("getHistory failed", e);
      return [];
    }
  }

  function addToHistory(name: string, value: string, max = 20) {
    try {
      const hist = getHistory(name);
      const next = [value, ...hist.filter((h) => h !== value)].slice(0, max);
      localStorage.setItem(
        `inspector_uuid_history_${name}`,
        JSON.stringify(next),
      );
    } catch (e) {
      console.debug("addToHistory failed", e);
    }
  }

  // Auto-fill conversationId from cookie when a tool with that field is selected
  const conversationId = params["conversationId"] as string | undefined;

  useEffect(() => {
    if (!selectedTool) return;
    const props = (selectedTool.inputSchema?.properties ?? {}) as Record<
      string,
      unknown
    >;
    if (!Object.prototype.hasOwnProperty.call(props, "conversationId")) return;

    try {
      const cookieVal = getCookie(`inspector_uuid_conversationId`);
      if (
        cookieVal &&
        (conversationId === undefined || conversationId === "")
      ) {
        setParams((prev) => ({ ...prev, conversationId: cookieVal }));
        toast({
          title: "Auto-filled conversationId",
          description: `Applied saved conversationId from cookie.`,
        });
      }
    } catch (e) {
      console.debug("auto-fill conversationId failed", e);
    }
  }, [selectedTool, conversationId, toast]);

  return (
    <TabsContent value="tools">
      <div className="grid grid-cols-2 gap-4">
        <ListPane
          items={tools}
          listItems={listTools}
          clearItems={() => {
            clearTools();
            setSelectedTool(null);
          }}
          setSelectedItem={setSelectedTool}
          renderItem={(tool) => (
            <div className="flex flex-col items-start">
              <span className="flex-1">{tool.name}</span>
              <span className="text-sm text-gray-500 text-left line-clamp-3">
                {tool.description}
              </span>
            </div>
          )}
          title="Tools"
          buttonText={nextCursor ? "List More Tools" : "List Tools"}
          isButtonDisabled={!nextCursor && tools.length > 0}
        />

        <div className="bg-card border border-border rounded-lg shadow">
          <div className="p-4 border-b border-gray-200 dark:border-border">
            <h3 className="font-semibold">
              {selectedTool ? selectedTool.name : "Select a tool"}
            </h3>
          </div>
          <div className="p-4">
            {selectedTool ? (
              <div className="space-y-4">
                {error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription className="break-all">
                      {error}
                    </AlertDescription>
                  </Alert>
                )}
                <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {selectedTool.description}
                </p>
                {Object.entries(selectedTool.inputSchema.properties ?? []).map(
                  ([key, value]) => {
                    const prop = normalizeUnionType(value as JsonSchemaType);
                    const inputSchema =
                      selectedTool.inputSchema as JsonSchemaType;
                    const required = isPropertyRequired(key, inputSchema);
                    return (
                      <div key={key}>
                        <div className="flex justify-between">
                          <Label
                            htmlFor={key}
                            className="block text-sm font-medium text-gray-700 dark:text-gray-300"
                          >
                            {key}
                            {required && (
                              <span className="text-red-500 ml-1">*</span>
                            )}
                          </Label>
                          {key === "conversationId" ? (
                            <div className="flex items-center space-x-2">
                              <Button
                                onClick={async () => {
                                  const uuid = uuidv4();
                                  try {
                                    navigator.clipboard.writeText(uuid);
                                  } catch (err) {
                                    console.debug(
                                      "clipboard write failed",
                                      err,
                                    );
                                  }
                                  // save per-field cookie name to avoid collisions
                                  try {
                                    setCookie(`inspector_uuid_${key}`, uuid);
                                    addToHistory(key, uuid);
                                    toast({
                                      title: "UUID saved",
                                      description: `Saved UUID for ${key} to cookie.`,
                                    });
                                  } catch (e) {
                                    console.debug("setCookie failed", e);
                                  }
                                  setParams({
                                    ...params,
                                    [key]: uuid,
                                  });
                                }}
                                className="mr-2"
                              >
                                UUID
                              </Button>

                              <Select
                                value={
                                  params[key] === undefined
                                    ? ""
                                    : String(params[key])
                                }
                                onValueChange={(value) => {
                                  if (value === "") return;
                                  setParams({ ...params, [key]: value });
                                }}
                              >
                                <SelectTrigger className="h-8 w-48">
                                  <SelectValue placeholder="History" />
                                </SelectTrigger>
                                <SelectContent>
                                  {getHistory(key).map((h) => (
                                    <SelectItem key={h} value={h}>
                                      {h}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}

                          {prop.nullable ? (
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id={key}
                                name={key}
                                checked={params[key] === null}
                                onCheckedChange={(checked: boolean) =>
                                  setParams({
                                    ...params,
                                    [key]: checked ? null : prop.default,
                                  })
                                }
                              />
                              <label
                                htmlFor={key}
                                className="text-sm font-medium text-gray-700 dark:text-gray-300"
                              >
                                null
                              </label>
                            </div>
                          ) : null}
                        </div>

                        <div
                          role="toolinputwrapper"
                          className={`${prop.nullable && params[key] === null ? "pointer-events-none opacity-50" : ""}`}
                        >
                          {prop.type === "boolean" ? (
                            <div className="flex items-center space-x-2 mt-2">
                              <Checkbox
                                id={key}
                                name={key}
                                checked={!!params[key]}
                                onCheckedChange={(checked: boolean) =>
                                  setParams({
                                    ...params,
                                    [key]: checked,
                                  })
                                }
                              />
                              <label
                                htmlFor={key}
                                className="text-sm font-medium text-gray-700 dark:text-gray-300"
                              >
                                {prop.description || "Toggle this option"}
                              </label>
                            </div>
                          ) : prop.type === "string" && prop.enum ? (
                            <Select
                              value={
                                params[key] === undefined
                                  ? ""
                                  : String(params[key])
                              }
                              onValueChange={(value) => {
                                if (value === "") {
                                  setParams({
                                    ...params,
                                    [key]: undefined,
                                  });
                                } else {
                                  setParams({
                                    ...params,
                                    [key]: value,
                                  });
                                }
                              }}
                            >
                              <SelectTrigger id={key} className="mt-1">
                                <SelectValue
                                  placeholder={
                                    prop.description || "Select an option"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent>
                                {prop.enum.map((option) => (
                                  <SelectItem key={option} value={option}>
                                    {option}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : prop.type === "string" ? (
                            <Textarea
                              id={key}
                              name={key}
                              placeholder={prop.description}
                              value={
                                params[key] === undefined
                                  ? ""
                                  : String(params[key])
                              }
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value === "") {
                                  // Field cleared - set to undefined
                                  setParams({
                                    ...params,
                                    [key]: undefined,
                                  });
                                } else {
                                  // Field has value - keep as string
                                  setParams({
                                    ...params,
                                    [key]: value,
                                  });
                                }
                              }}
                              className="mt-1"
                            />
                          ) : prop.type === "object" ||
                            prop.type === "array" ? (
                            <div className="mt-1">
                              <DynamicJsonForm
                                ref={(ref) => (formRefs.current[key] = ref)}
                                schema={{
                                  type: prop.type,
                                  properties: prop.properties,
                                  description: prop.description,
                                  items: prop.items,
                                }}
                                value={
                                  (params[key] as JsonValue) ??
                                  generateDefaultValue(prop)
                                }
                                onChange={(newValue: JsonValue) => {
                                  setParams({
                                    ...params,
                                    [key]: newValue,
                                  });
                                  // Check validation after a short delay to allow form to update
                                  setTimeout(checkValidationErrors, 100);
                                }}
                              />
                            </div>
                          ) : prop.type === "number" ||
                            prop.type === "integer" ? (
                            <Input
                              type="number"
                              id={key}
                              name={key}
                              placeholder={prop.description}
                              value={
                                params[key] === undefined
                                  ? ""
                                  : String(params[key])
                              }
                              onChange={(e) => {
                                const value = e.target.value;
                                if (value === "") {
                                  // Field cleared - set to undefined
                                  setParams({
                                    ...params,
                                    [key]: undefined,
                                  });
                                } else {
                                  // Field has value - try to convert to number, but store input either way
                                  const num = Number(value);
                                  if (!isNaN(num)) {
                                    setParams({
                                      ...params,
                                      [key]: num,
                                    });
                                  } else {
                                    // Store invalid input as string - let server validate
                                    setParams({
                                      ...params,
                                      [key]: value,
                                    });
                                  }
                                }
                              }}
                              className="mt-1"
                            />
                          ) : (
                            <div className="mt-1">
                              <DynamicJsonForm
                                ref={(ref) => (formRefs.current[key] = ref)}
                                schema={{
                                  type: prop.type,
                                  properties: prop.properties,
                                  description: prop.description,
                                  items: prop.items,
                                }}
                                value={params[key] as JsonValue}
                                onChange={(newValue: JsonValue) => {
                                  setParams({
                                    ...params,
                                    [key]: newValue,
                                  });
                                  // Check validation after a short delay to allow form to update
                                  setTimeout(checkValidationErrors, 100);
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  },
                )}
                {selectedTool.outputSchema && (
                  <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold">Output Schema:</h4>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setIsOutputSchemaExpanded(!isOutputSchemaExpanded)
                        }
                        className="h-6 px-2"
                      >
                        {isOutputSchemaExpanded ? (
                          <>
                            <ChevronUp className="h-3 w-3 mr-1" />
                            Collapse
                          </>
                        ) : (
                          <>
                            <ChevronDown className="h-3 w-3 mr-1" />
                            Expand
                          </>
                        )}
                      </Button>
                    </div>
                    <div
                      className={`transition-all ${
                        isOutputSchemaExpanded
                          ? ""
                          : "max-h-[8rem] overflow-y-auto"
                      }`}
                    >
                      <JsonView data={selectedTool.outputSchema} />
                    </div>
                  </div>
                )}
                {selectedTool &&
                  hasMeta(selectedTool) &&
                  selectedTool._meta && (
                    <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold">Meta:</h4>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setIsMetaExpanded(!isMetaExpanded)}
                          className="h-6 px-2"
                        >
                          {isMetaExpanded ? (
                            <>
                              <ChevronUp className="h-3 w-3 mr-1" />
                              Collapse
                            </>
                          ) : (
                            <>
                              <ChevronDown className="h-3 w-3 mr-1" />
                              Expand
                            </>
                          )}
                        </Button>
                      </div>
                      <div
                        className={`transition-all ${
                          isMetaExpanded ? "" : "max-h-[8rem] overflow-y-auto"
                        }`}
                      >
                        <JsonView data={selectedTool._meta} />
                      </div>
                    </div>
                  )}
                <div className="flex gap-2">
                  <Button
                    onClick={async () => {
                      // Validate JSON inputs before calling tool
                      if (checkValidationErrors()) return;

                      try {
                        setIsToolRunning(true);
                        await callTool(selectedTool.name, params);
                      } finally {
                        setIsToolRunning(false);
                      }
                    }}
                    disabled={isToolRunning || hasValidationErrors}
                  >
                    {isToolRunning ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Running...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Run Tool
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={async () => {
                      try {
                        navigator.clipboard.writeText(
                          JSON.stringify(params, null, 2),
                        );
                        setCopied(true);
                      } catch (error) {
                        toast({
                          title: "Error",
                          description: `There was an error copying input to the clipboard: ${error instanceof Error ? error.message : String(error)}`,
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    {copied ? (
                      <CheckCheck className="h-4 w-4 mr-2 dark:text-green-700 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4 mr-2" />
                    )}
                    Copy Input
                  </Button>
                </div>
                <ToolResults
                  toolResult={toolResult}
                  selectedTool={selectedTool}
                  resourceContent={resourceContent}
                  onReadResource={onReadResource}
                />
              </div>
            ) : (
              <Alert>
                <AlertDescription>
                  Select a tool from the list to view its details and run it
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </div>
    </TabsContent>
  );
};

export default ToolsTab;
