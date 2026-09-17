function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function event(name: string, data: Record<string, unknown>, seq: number): string {
  return `event: ${name}\ndata: ${JSON.stringify({ type: name, sequence_number: seq, ...data })}\n\n`;
}

function outputText(item: Record<string, unknown>): string {
  const content = Array.isArray(item.content) ? item.content : [];
  return content.map(part => {
    const record = asRecord(part);
    return typeof record?.text === "string" ? record.text : "";
  }).join("");
}

export function responseJsonToSse(response: Record<string, unknown>): Response {
  const encoder = new TextEncoder();
  const id = typeof response.id === "string" ? response.id : `resp_${crypto.randomUUID().replaceAll("-", "")}`;
  const model = typeof response.model === "string" ? response.model : "teamsix/chatgpt-web/high";
  const createdAt = typeof response.created_at === "number" ? response.created_at : Math.floor(Date.now() / 1000);
  const output = Array.isArray(response.output) ? response.output.map(asRecord).filter(Boolean) as Record<string, unknown>[] : [];

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let seq = 0;
      const emit = (name: string, data: Record<string, unknown>) => controller.enqueue(encoder.encode(event(name, data, seq++)));
      const created = { id, object: "response", created_at: createdAt, status: "in_progress", model, output: [], usage: null };
      emit("response.created", { response: created });

      output.forEach((finalItem, outputIndex) => {
        const type = finalItem.type;
        if (type === "function_call") {
          const itemId = typeof finalItem.id === "string" ? finalItem.id : `fc_${crypto.randomUUID().replaceAll("-", "")}`;
          const callId = typeof finalItem.call_id === "string" ? finalItem.call_id : `call_${crypto.randomUUID().replaceAll("-", "")}`;
          const name = typeof finalItem.name === "string" ? finalItem.name : "unknown";
          const args = typeof finalItem.arguments === "string" ? finalItem.arguments : JSON.stringify(finalItem.arguments ?? {});
          const inProgress = { ...finalItem, id: itemId, call_id: callId, name, arguments: "", status: "in_progress" };
          emit("response.output_item.added", { output_index: outputIndex, item: inProgress });
          if (args) emit("response.function_call_arguments.delta", { item_id: itemId, output_index: outputIndex, delta: args });
          emit("response.function_call_arguments.done", { item_id: itemId, output_index: outputIndex, arguments: args || "{}" });
          emit("response.output_item.done", { output_index: outputIndex, item: { ...finalItem, id: itemId, call_id: callId, name, arguments: args || "{}", status: "completed" } });
          return;
        }

        if (type === "message") {
          const itemId = typeof finalItem.id === "string" ? finalItem.id : `msg_${crypto.randomUUID().replaceAll("-", "")}`;
          const text = outputText(finalItem);
          const inProgress = { type: "message", id: itemId, status: "in_progress", role: "assistant", content: [] };
          emit("response.output_item.added", { output_index: outputIndex, item: inProgress });
          emit("response.content_part.added", {
            item_id: itemId,
            output_index: outputIndex,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          });
          if (text) emit("response.output_text.delta", { item_id: itemId, output_index: outputIndex, content_index: 0, delta: text });
          emit("response.output_text.done", { item_id: itemId, output_index: outputIndex, content_index: 0, text });
          emit("response.content_part.done", {
            item_id: itemId,
            output_index: outputIndex,
            content_index: 0,
            part: { type: "output_text", text, annotations: [] },
          });
          emit("response.output_item.done", {
            output_index: outputIndex,
            item: {
              ...finalItem,
              id: itemId,
              status: "completed",
              role: "assistant",
              content: [{ type: "output_text", text, annotations: [] }],
            },
          });
          return;
        }

        emit("response.output_item.added", { output_index: outputIndex, item: finalItem });
        emit("response.output_item.done", { output_index: outputIndex, item: finalItem });
      });

      const terminal = {
        ...response,
        id,
        object: "response",
        created_at: createdAt,
        model,
        status: response.status === "failed" ? "failed" : response.status === "incomplete" ? "incomplete" : "completed",
        output,
      };
      const terminalEvent = terminal.status === "failed"
        ? "response.failed"
        : terminal.status === "incomplete"
          ? "response.incomplete"
          : "response.completed";
      emit(terminalEvent, { response: terminal });
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
