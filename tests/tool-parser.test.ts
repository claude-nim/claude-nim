// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details
import {
  parseTextEmbeddedToolCalls,
  unwrapJsonCodeFence,
} from "../src/translator/tool-parser";

describe("parseTextEmbeddedToolCalls", () => {
  describe("OpenAI format (<|tool_call_begin|>)", () => {
    it("should parse a single tool call", () => {
      const result = parseTextEmbeddedToolCalls(
        '<|tool_call_begin|>read_file<|tool_call_argument_begin|>{"filePath":"foo.ts"}<|tool_call_end|>',
      );
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0]).toEqual({
        type: "toolCall",
        toolCall: { name: "read_file", args: { filePath: "foo.ts" } },
      });
    });

    it("should parse text before a tool call", () => {
      const result = parseTextEmbeddedToolCalls(
        'Let me check.\n<|tool_call_begin|>read_file<|tool_call_argument_begin|>{"filePath":"bar.ts"}<|tool_call_end|>',
      );
      expect(result.segments).toHaveLength(2);
      expect(result.segments[0].type).toBe("text");
      expect(result.segments[1].type).toBe("toolCall");
    });

    it("should handle multiple tool calls in sequence", () => {
      const result = parseTextEmbeddedToolCalls(
        '<|tool_call_begin|>read_file<|tool_call_argument_begin|>{"filePath":"a.ts"}<|tool_call_end|>' +
          '<|tool_call_begin|>list_dir<|tool_call_argument_begin|>{"path":"/src"}<|tool_call_end|>',
      );
      expect(result.segments).toHaveLength(2);
      expect((result.segments[0] as any).toolCall.name).toBe("read_file");
      expect((result.segments[1] as any).toolCall.name).toBe("list_dir");
    });

    it("should handle text between multiple tool calls", () => {
      const result = parseTextEmbeddedToolCalls(
        '<|tool_call_begin|>read_file<|tool_call_argument_begin|>{"filePath":"a.ts"}<|tool_call_end|>' +
          "Some text between" +
          '<|tool_call_begin|>list_dir<|tool_call_argument_begin|>{"path":"/src"}<|tool_call_end|>',
      );
      expect(result.segments).toHaveLength(3);
      expect(result.segments[0].type).toBe("toolCall");
      expect(result.segments[1].type).toBe("text");
      expect((result.segments[1] as any).text).toBe("Some text between");
      expect(result.segments[2].type).toBe("toolCall");
    });

    it("should treat malformed JSON as invalidToolCall", () => {
      const result = parseTextEmbeddedToolCalls(
        "<|tool_call_begin|>read_file<|tool_call_argument_begin|>{bad json}<|tool_call_end|>",
      );
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].type).toBe("invalidToolCall");
      expect((result.segments[0] as any).name).toBe("read_file");
    });
  });

  describe("plain text (no tool calls)", () => {
    it("should return plain text as-is", () => {
      const result = parseTextEmbeddedToolCalls(
        "Hello, this is a normal response.",
      );
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].type).toBe("text");
      expect((result.segments[0] as any).text).toBe(
        "Hello, this is a normal response.",
      );
    });

    it("should handle empty text", () => {
      const result = parseTextEmbeddedToolCalls("");
      expect(result.segments).toHaveLength(0);
    });
  });

  describe("streaming / partial tokens", () => {
    it("should detect incomplete tool_call_begin token at end", () => {
      const result = parseTextEmbeddedToolCalls("some text<|tool_cal");
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].type).toBe("text");
      expect((result.segments[0] as any).text).toBe("some text");
      expect(result.incompleteText).toBe("<|tool_cal");
    });

    it("should buffer incomplete tool call (missing arg_begin)", () => {
      const result = parseTextEmbeddedToolCalls(
        "<|tool_call_begin|>read_file<|too",
      );
      expect(result.incompleteText.length).toBeGreaterThan(0);
    });
  });

  describe("DeepSeek format (<｜tool▁call▁begin｜>)", () => {
    it("should parse a single DeepSeek tool call", () => {
      const result = parseTextEmbeddedToolCalls(
        "<｜tool▁call▁begin｜><｜tool▁sep｜>read_file\n" +
          "```json\n" +
          '{"filePath":"foo.ts"}\n' +
          "```<｜tool▁call▁end｜>",
      );
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0]).toEqual({
        type: "toolCall",
        toolCall: { name: "read_file", args: { filePath: "foo.ts" } },
      });
    });

    it("should strip DSML control tokens", () => {
      const result = parseTextEmbeddedToolCalls(
        "Some text <｜DSML｜> with control token <|DSML|> hidden.",
      );
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].type).toBe("text");
      expect((result.segments[0] as any).text).toBe(
        "Some text  with control token  hidden.",
      );
    });

    it("should handle incomplete DeepSeek tokens", () => {
      const result = parseTextEmbeddedToolCalls("text <｜tool▁call▁be");
      expect(result.incompleteText).toBe("<｜tool▁call▁be");
    });
  });

  describe("mixed content", () => {
    it("should handle tool call with text on both sides", () => {
      const result = parseTextEmbeddedToolCalls(
        'First text. <|tool_call_begin|>read_file<|tool_call_argument_begin|>{"filePath":"x.ts"}<|tool_call_end|> Last text.',
      );
      expect(result.segments).toHaveLength(3);
      expect(result.segments[0].type).toBe("text");
      expect(result.segments[1].type).toBe("toolCall");
      expect(result.segments[2].type).toBe("text");
    });

    it("should handle code fences inside plain text", () => {
      const result = parseTextEmbeddedToolCalls(
        "Here is code:\n```ts\nconst x = 1;\n```\nDone.",
      );
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].type).toBe("text");
    });
  });
});

describe("unwrapJsonCodeFence", () => {
  it("should unwrap JSON code fences", () => {
    expect(unwrapJsonCodeFence('```json\n{"key": "value"}\n```')).toBe(
      '{"key": "value"}',
    );
  });

  it("should unwrap plain code fences", () => {
    expect(unwrapJsonCodeFence('```\n{"key": "value"}\n```')).toBe(
      '{"key": "value"}',
    );
  });

  it("should return text as-is if not fenced", () => {
    expect(unwrapJsonCodeFence("plain text")).toBe("plain text");
  });
});
