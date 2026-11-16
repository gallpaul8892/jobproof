/**
 * The browser demo's phone frame: a centred 390 x 844 screen with a bezel, a permanent note and a
 * link back to the landing page. On a real phone (narrow screen) it is full screen. The app itself
 * is untouched: this only wraps the element it mounts into (#root).
 */
export const DEMO_NOTE = "Demo with sample data. Nothing is saved.";
export const FRAME_WIDTH = 390;
export const FRAME_HEIGHT = 844;

export const FRAME_CSS = `
html, body { margin: 0; height: 100%; }
body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 12px; box-sizing: border-box; background: #e9ecef; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
.demo-note { display: flex; flex-wrap: wrap; gap: 4px 16px; align-items: center; justify-content: center; color: #1b1f23; font-size: 14px; line-height: 20px; max-width: ${FRAME_WIDTH + 80}px; text-align: center; }
.demo-note a { color: #0b4a8f; font-weight: 600; min-height: 24px; display: inline-flex; align-items: center; }
.demo-phone { position: relative; flex: 0 1 auto; width: min(${FRAME_WIDTH}px, 100%); height: min(${FRAME_HEIGHT}px, calc(100dvh - 90px)); border: 10px solid #1b1f23; border-radius: 36px; overflow: hidden; background: #fff; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25); box-sizing: content-box; transform: translateZ(0); }
.demo-phone #root { position: absolute; inset: 0; display: flex; }
.demo-layer { position: absolute; inset: 0; pointer-events: none; z-index: 1000; }
.demo-layer > * { pointer-events: auto; }
.demo-layer > [data-demo-modal] { pointer-events: none; }
.demo-layer > [data-demo-modal] > * { pointer-events: auto; }
.demo-sheet { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.5); display: flex; align-items: flex-end; }
.demo-sheet-card { background: #fff; width: 100%; box-sizing: border-box; padding: 16px; border-radius: 16px 16px 0 0; max-height: 100%; overflow: auto; color: #1b1f23; }
.demo-sheet-card h2 { margin: 0 0 4px; font-size: 20px; }
.demo-sheet-card p { margin: 0 0 12px; font-size: 14px; color: #4a5560; }
.demo-sample { display: flex; align-items: center; gap: 12px; padding: 8px; min-height: 56px; border: 2px solid #8a949e; border-radius: 8px; margin-bottom: 8px; cursor: pointer; font-size: 16px; }
.demo-sample input { width: 24px; height: 24px; }
.demo-sample img { width: 64px; height: 48px; object-fit: cover; border-radius: 4px; }
.demo-actions { display: flex; gap: 8px; margin-top: 8px; }
.demo-actions button { flex: 1; min-height: 52px; font-size: 18px; font-weight: 700; border-radius: 8px; border: 2px solid #1b1f23; background: #fff; color: #1b1f23; cursor: pointer; }
.demo-actions button.primary { background: #1b1f23; color: #fff; }
@media (max-width: 480px) {
  body { padding: 0; gap: 0; justify-content: flex-start; }
  .demo-note { padding: 6px 8px; font-size: 13px; line-height: 18px; flex: 0 0 auto; }
  .demo-phone { width: 100%; height: auto; flex: 1 1 auto; min-height: 0; border: 0; border-radius: 0; box-shadow: none; }
}
`;

export interface Frame {
  layer: HTMLElement;
  note: HTMLElement;
}

let frame: Frame | undefined;

/** Builds the frame once and returns it. Needs a browser document with a #root element. */
export function installFrame(homeUrl: string, signIn?: { email: string; password: string }, doc: Document = document): Frame {
  if (frame && doc.body.contains(frame.layer)) return frame;
  const style = doc.createElement("style");
  style.setAttribute("data-demo-frame", "");
  style.textContent = FRAME_CSS;
  doc.head.appendChild(style);
  if (!doc.querySelector("link[rel~='icon']")) {
    const icon = doc.createElement("link");
    icon.rel = "icon";
    icon.href = "data:,"; // no favicon request (the demo ships no icon file)
    doc.head.appendChild(icon);
  }

  const note = doc.createElement("div");
  note.className = "demo-note";
  note.setAttribute("role", "status");
  note.setAttribute("data-testid", "demo-note");
  const text = doc.createElement("span");
  text.textContent = DEMO_NOTE;
  const back = doc.createElement("a");
  back.href = homeUrl;
  back.textContent = "Back to all demos";
  back.setAttribute("data-testid", "demo-home-link");
  note.append(text);
  if (signIn) {
    const hint = doc.createElement("span");
    hint.setAttribute("data-testid", "demo-signin-hint");
    hint.textContent = `Sign in with ${signIn.email} and ${signIn.password}`;
    note.append(hint);
  }
  note.append(back);

  const phone = doc.createElement("div");
  phone.className = "demo-phone";
  phone.setAttribute("data-testid", "demo-phone");
  const layer = doc.createElement("div");
  layer.className = "demo-layer";
  layer.setAttribute("data-testid", "demo-layer");

  const root = doc.getElementById("root");
  doc.body.prepend(note, phone);
  if (root) phone.appendChild(root);
  phone.appendChild(layer);
  frame = { layer, note };
  return frame;
}

/** For tests. */
export function resetFrameForTests(): void {
  frame = undefined;
}

/** The layer overlays are drawn into, or document.body when there is no frame (tests, native). */
export function overlayHost(): HTMLElement {
  return frame?.layer ?? document.body;
}

/** A bottom sheet in the frame asking which sample pictures to add (the demo's stand-in for the photo picker). */
export function chooseSamples(samples: readonly { id: string; title: string }[], limit: number, preview: (index: number) => string, doc: Document = document): Promise<number[] | null> {
  return new Promise((resolve) => {
    const sheet = doc.createElement("div");
    sheet.className = "demo-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "demo-sheet-title");
    sheet.setAttribute("data-testid", "demo-sample-picker");
    const card = doc.createElement("div");
    card.className = "demo-sheet-card";
    const h = doc.createElement("h2");
    h.id = "demo-sheet-title";
    h.textContent = "Choose sample photos";
    const p = doc.createElement("p");
    p.textContent = `Demo gallery: pictures drawn in your browser. Up to ${limit} can be added.`;
    card.append(h, p);
    const inputs: HTMLInputElement[] = [];
    samples.forEach((s, i) => {
      const label = doc.createElement("label");
      label.className = "demo-sample";
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.setAttribute("data-testid", `demo-sample-${s.id}`);
      inputs.push(input);
      const img = doc.createElement("img");
      img.alt = "";
      img.src = preview(i);
      const name = doc.createElement("span");
      name.textContent = s.title;
      label.append(input, img, name);
      card.appendChild(label);
    });
    const actions = doc.createElement("div");
    actions.className = "demo-actions";
    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.setAttribute("data-testid", "demo-sample-cancel");
    const add = doc.createElement("button");
    add.type = "button";
    add.className = "primary";
    add.textContent = "Add photos";
    add.setAttribute("data-testid", "demo-sample-add");
    actions.append(cancel, add);
    card.appendChild(actions);
    sheet.appendChild(card);
    const done = (value: number[] | null) => {
      sheet.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => done(null));
    sheet.addEventListener("click", (e) => {
      if (e.target === sheet) done(null);
    });
    doc.addEventListener(
      "keydown",
      function onKey(e) {
        if (e.key !== "Escape" || !sheet.isConnected) return;
        doc.removeEventListener("keydown", onKey);
        done(null);
      },
    );
    add.addEventListener("click", () => {
      const picked = inputs.flatMap((input, i) => (input.checked ? [i] : []));
      done(picked.length > 0 ? picked.slice(0, limit) : null);
    });
    (frame?.layer ?? doc.body).appendChild(sheet);
    inputs[0]?.focus();
  });
}
