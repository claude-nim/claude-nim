import { toOpenAIRequest, toAnthropicResponse } from "../src/translator";

describe("Translator", () => {
  describe("toOpenAIRequest", () => {
    it("should convert a simple Anthropic message to OpenAI format", () => {
      const body: Record<string, unknown> = {
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: "Hello" }],
      };
      const result = toOpenAIRequest(
        body,
        "meta/llama-3.3-70b-instruct",
        {} as any,
      );
      expect(result.model).toBe("meta/llama-3.3-70b-instruct");
      expect(result.messages).toBeDefined();
      expect((result.messages as any[])[0].role).toBe("user");
      expect(result.max_tokens).toBe(4096);
    });

    it("should handle system prompt conversion", () => {
      const body: Record<string, unknown> = {
        model: "claude-sonnet-4-20250514",
        system: "You are a helpful assistant",
        messages: [{ role: "user", content: "Hi" }],
      };
      const result = toOpenAIRequest(
        body,
        "meta/llama-3.3-70b-instruct",
        {} as any,
      );
      const messages = result.messages as any[];
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("You are a helpful assistant");
    });

    it("should handle tool_choice auto", () => {
      const body: Record<string, unknown> = {
        model: "claude-sonnet-4-20250514",
        messages: [{ role: "user", content: "Use a tool" }],
        tools: [
          {
            name: "test_tool",
            input_schema: { type: "object", properties: {} },
          },
        ],
        tool_choice: { type: "auto" },
      };
      const result = toOpenAIRequest(
        body,
        "meta/llama-3.3-70b-instruct",
        {} as any,
      );
      expect(result.tool_choice).toBe("auto");
    });
  });

  describe("toAnthropicResponse", () => {
    it("should convert OpenAI response back to Anthropic format", () => {
      const openaiResult: Record<string, unknown> = {
        id: "chatcmpl-123",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello there!",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
        },
      };
      const result = toAnthropicResponse(
        openaiResult,
        "meta/llama-3.3-70b-instruct",
      );
      expect(result.type).toBe("message");
      expect(result.role).toBe("assistant");
      expect((result.content as any[])[0].text).toBe("Hello there!");
      expect(result.model).toBe("meta/llama-3.3-70b-instruct");
      const usage = result.usage as {
        input_tokens: number;
        output_tokens: number;
      };
      expect(usage.input_tokens).toBe(10);
      expect(usage.output_tokens).toBe(5);
    });

    it("should detect DeepSeek text-embedded tool calls", () => {
      const openaiResult: Record<string, unknown> = {
        choices: [
          {
            message: {
              content:
                '<｜tool▁call▁begin｜><｜tool▁sep｜>read_file\n```json\n{"filePath":"foo.ts"}\n```<｜tool▁call▁end｜>',
            },
            finish_reason: "stop",
          },
        ],
      };
      const result = toAnthropicResponse(openaiResult, "deepseek-model");
      const content = result.content as Array<{
        type: string;
        text?: string;
        name?: string;
        id?: string;
      }>;
      const toolUse = content.find((c) => c.type === "tool_use");
      expect(toolUse).toBeDefined();
      expect(toolUse!.name).toBe("read_file");
      expect(result.stop_reason).toBe("tool_use");
    });

    it("should detect OpenAI token-style text-embedded tool calls", () => {
      const openaiResult: Record<string, unknown> = {
        choices: [
          {
            message: {
              content:
                '<|tool_call_begin|>list_dir<|tool_call_argument_begin|>{"path":"/src"}<|tool_call_end|>',
            },
            finish_reason: "stop",
          },
        ],
      };
      const result = toAnthropicResponse(openaiResult, "qwen-model");
      const content = result.content as Array<{ type: string; name?: string }>;
      const toolUse = content.find((c) => c.type === "tool_use");
      expect(toolUse).toBeDefined();
      expect(toolUse!.name).toBe("list_dir");
      expect(result.stop_reason).toBe("tool_use");
    });

    it("should handle mixed text and embedded tool calls", () => {
      const openaiResult: Record<string, unknown> = {
        choices: [
          {
            message: {
              content:
                'Let me check that file.\n<|tool_call_begin|>read_file<|tool_call_argument_begin|>{"filePath":"bar.ts"}<|tool_call_end|>',
            },
            finish_reason: "stop",
          },
        ],
      };
      const result = toAnthropicResponse(openaiResult, "some-model");
      const content = result.content as Array<{
        type: string;
        text?: string;
        name?: string;
      }>;
      const textBlock = content.find((c) => c.type === "text");
      const toolBlock = content.find((c) => c.type === "tool_use");
      expect(textBlock).toBeDefined();
      expect(textBlock!.text).toContain("Let me check that file.");
      expect(toolBlock).toBeDefined();
      expect(toolBlock!.name).toBe("read_file");
    });

    it("should prefer structured tool_calls over text-embedded ones", () => {
      const openaiResult: Record<string, unknown> = {
        choices: [
          {
            message: {
              content:
                '<|tool_call_begin|>some_tool<|tool_call_argument_begin|>{"a":1}<|tool_call_end|>',
              tool_calls: [
                {
                  id: "call_123",
                  function: { name: "real_tool", arguments: '{"b":2}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };
      const result = toAnthropicResponse(openaiResult, "model");
      const content = result.content as Array<{
        type: string;
        name?: string;
        text?: string;
      }>;
      const toolUse = content.find((c) => c.type === "tool_use");
      expect(toolUse).toBeDefined();
      expect(toolUse!.name).toBe("real_tool");
      expect(result.stop_reason).toBe("tool_use");
    });

    it("should handle empty text with no tool calls", () => {
      const openaiResult: Record<string, unknown> = {
        choices: [
          {
            message: { content: "Normal response text." },
            finish_reason: "stop",
          },
        ],
      };
      const result = toAnthropicResponse(openaiResult, "model");
      const content = result.content as Array<{ type: string }>;
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe("text");
      expect(result.stop_reason).toBe("end_turn");
    });
  });
});
