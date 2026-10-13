import { session } from "./session";
import { bindClickHandlers } from "./main-handlers-click.js";
import { bindPointerHandlers } from "./main-handlers-pointer.js";

export function ensureDelegatedHandlers(): void {
  if (session.handlersBound) return;
  session.handlersBound = true;
  bindPointerHandlers();
  bindClickHandlers();
}
