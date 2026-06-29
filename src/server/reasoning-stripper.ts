// Copyright (c) 2026 Rithika Liyanage (https://github.com/k-rithik04)
// Licensed under the MIT License - see LICENSE for details

/**
 * Strips `<think>…</think>` reasoning blocks from streaming text chunks.
 * Handles partial tags that span multiple chunks.
 */
export class ReasoningStripper {
  private buffer = "";
  private insideThink = false;
  /** Track cumulative non-whitespace text emitted to distinguish head reasoning from mid-content <think> */
  private emittedTextLength = 0;

  process(chunk: string): string {
    this.buffer += chunk;
    let output = "";

    while (this.buffer.length > 0) {
      if (this.insideThink) {
        const endIndex = this.buffer.indexOf("</think>");
        if (endIndex !== -1) {
          this.insideThink = false;
          this.buffer = this.buffer.slice(endIndex + 8);
        } else {
          this.buffer = "";
          break;
        }
      } else {
        const startIndex = this.buffer.indexOf("<think>");
        if (startIndex !== -1) {
          // Heuristic: only treat <think> as reasoning if it appears early
          // (before significant content has been emitted). If we've already
          // emitted >200 non-whitespace chars, treat it as literal content.
          const isLikelyReasoning = this.emittedTextLength < 200;
          if (isLikelyReasoning) {
            output += this.buffer.slice(0, startIndex);
            this.insideThink = true;
            this.buffer = this.buffer.slice(startIndex + 7);
          } else {
            // Emit as literal content
            output += this.buffer.slice(0, startIndex + 7);
            this.buffer = this.buffer.slice(startIndex + 7);
          }
        } else {
          const possiblePartial = this.buffer.lastIndexOf("<");
          if (
            possiblePartial !== -1 &&
            "<think>".startsWith(this.buffer.slice(possiblePartial))
          ) {
            output += this.buffer.slice(0, possiblePartial);
            this.buffer = this.buffer.slice(possiblePartial);
            break;
          } else {
            output += this.buffer;
            this.buffer = "";
          }
        }
      }
    }

    // Track emitted text length for heuristic
    if (!this.insideThink) {
      this.emittedTextLength += output.replace(/\s+/g, "").length;
    }
    return output;
  }

  flush(): string {
    if (this.insideThink) {
      this.buffer = "";
      this.insideThink = false;
      return "";
    }
    const out = this.buffer;
    this.buffer = "";
    return out;
  }
}
