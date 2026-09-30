/** Supplies deterministic capability choices while exercising the real chat host. */
import type { ChatModel, ModelResponse } from "../../src/chat/model.js";

export class ScriptedChatModel implements ChatModel {
  #responses: ModelResponse[];

  constructor(responses: readonly ModelResponse[]) {
    this.#responses = [...responses];
  }

  async next(): Promise<ModelResponse> {
    const response = this.#responses.shift();
    if (response === undefined)
      throw new Error("Scripted chat model has no next response");
    return response;
  }
}
