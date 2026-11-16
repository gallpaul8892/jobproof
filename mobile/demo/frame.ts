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
.demo-phone { position: relative; flex: 0 0 auto; width: ${FRAME_WIDTH}px; max-width: 100%; height: min(${FRAME_HEIGHT}px, calc(100dvh - 90px)); border: 10px solid #1b1f23; border-radius: 36px; overflow: hidden; background: #fff; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25); box-sizing: content-box; transform: translateZ(0); }
.demo-phone #root { position: absolute; inset: 0; display: flex; }
.demo-stage { display: flex; align-items: center; justify-content: center; gap: 24px; min-height: 0; max-width: 100%; }
.demo-logins { flex: 0 0 300px; width: 300px; box-sizing: border-box; align-self: center; background: #fff; border: 2px solid #1b1f23; border-radius: 12px; padding: 12px 16px; color: #1b1f23; font-size: 14px; line-height: 20px; max-height: calc(100dvh - 90px); overflow: auto; }
.demo-logins > summary { font-size: 18px; font-weight: 700; cursor: pointer; min-height: 32px; display: flex; align-items: center; }
.demo-logins > p { margin: 8px 0; color: #4a5560; }
.demo-logins ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.demo-logins li { background: #f4f7f2; border: 1px solid #c9d0c6; border-radius: 8px; padding: 10px 12px; display: grid; grid-template-columns: 1fr auto; column-gap: 12px; align-items: center; }
.demo-logins li .demo-role { grid-column: 1; font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #2f5d3a; }
.demo-logins li strong { grid-column: 1; font-size: 16px; }
.demo-logins li > span { grid-column: 1; }
.demo-logins li button { grid-column: 2; grid-row: 1 / span 4; align-self: center; }
.demo-logins code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 14px; overflow-wrap: anywhere; }
.demo-logins button { min-height: 44px; min-width: 64px; padding: 0 16px; font-size: 16px; font-weight: 600; border-radius: 8px; border: 1px solid #8a949e; background: #fff; color: #1b1f23; cursor: pointer; }
.demo-logins button:focus-visible, .demo-logins summary:focus-visible { outline: 3px solid #0b4a8f; outline-offset: 2px; }
.demo-logins-status { min-height: 20px; margin: 8px 0 0; font-weight: 600; }
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
@media (max-width: 900px) {
  .demo-stage { flex-direction: column; gap: 8px; width: 100%; }
  .demo-logins { order: -1; flex: 0 0 auto; width: min(${FRAME_WIDTH + 20}px, 100%); max-height: 45dvh; }
  .demo-phone { height: min(${FRAME_HEIGHT}px, calc(100dvh - 190px)); flex: 0 1 auto; }
}
@media (max-width: 480px) {
  .demo-stage { flex: 1 1 auto; width: 100%; justify-content: flex-start; align-items: stretch; gap: 0; }
  .demo-logins { width: 100%; border-width: 0 0 2px; border-radius: 0; padding: 4px 8px; }
  body { padding: 0; gap: 0; justify-content: flex-start; }
  .demo-note { padding: 6px 8px; font-size: 13px; line-height: 18px; flex: 0 0 auto; }
  .demo-phone { width: 100%; height: auto; flex: 1 1 auto; min-height: 0; border: 0; border-radius: 0; box-shadow: none; }
}
`;

/** A login the panel offers. The jobs behind it never reach the frame. */
export interface DemoLoginInfo {
  name: string;
  email: string;
  password: string;
}

export const SIGN_IN_EMAIL_ID = "sign-in-email";
export const SIGN_IN_PASSWORD_ID = "sign-in-password";

/**
 * Types a login into the app's sign-in fields from outside, the way a user's input would arrive:
 * the native value setter (so React's tracker sees a change) and a bubbling `input` event, which
 * is what react-native-web's TextInput listens to. The app's code is not involved. Returns false
 * when the sign-in screen is not showing.
 */
export function fillSignIn(login: { email: string; password: string }, doc: Document = document): boolean {
  const email = doc.querySelector<HTMLInputElement>(`[data-testid="${SIGN_IN_EMAIL_ID}"]`);
  const password = doc.querySelector<HTMLInputElement>(`[data-testid="${SIGN_IN_PASSWORD_ID}"]`);
  if (!email || !password) return false;
  const set = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  set(email, login.email);
  set(password, login.password);
  return true;
}

export interface Frame {
  layer: HTMLElement;
  note: HTMLElement;
}

let frame: Frame | undefined;

/** Builds the frame once and returns it. Needs a browser document with a #root element. */
export function installFrame(homeUrl: string, logins: readonly DemoLoginInfo[] = [], doc: Document = document): Frame {
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
  note.append(back);

  const phone = doc.createElement("div");
  phone.className = "demo-phone";
  phone.setAttribute("data-testid", "demo-phone");
  const layer = doc.createElement("div");
  layer.className = "demo-layer";
  layer.setAttribute("data-testid", "demo-layer");

  const root = doc.getElementById("root");
  const stage = doc.createElement("div");
  stage.className = "demo-stage";
  stage.setAttribute("data-testid", "demo-stage");
  stage.appendChild(phone);
  if (logins.length > 0) stage.appendChild(loginsPanel(logins, doc));
  doc.body.prepend(note, stage);
  if (root) phone.appendChild(root);
  phone.appendChild(layer);
  frame = { layer, note };
  return frame;
}

/** "Demo logins": every operative who can sign in, each with a button that fills the sign-in fields. */
function loginsPanel(logins: readonly DemoLoginInfo[], doc: Document): HTMLElement {
  const panel = doc.createElement("details");
  panel.className = "demo-logins";
  panel.setAttribute("data-testid", "demo-logins");
  // Collapsed by default everywhere, so it takes no room until the visitor opens it.
  panel.open = false;
  const summary = doc.createElement("summary");
  summary.textContent = "Demo logins";
  const intro = doc.createElement("p");
  intro.textContent = "Sample operatives, each with their own jobs. These passwords only work in this demo.";
  const status = doc.createElement("p");
  status.className = "demo-logins-status";
  status.setAttribute("role", "status");
  status.setAttribute("data-testid", "demo-logins-status");
  const list = doc.createElement("ul");
  logins.forEach((login, i) => {
    const item = doc.createElement("li");
    item.setAttribute("data-testid", `demo-login-${i}`);
    const name = doc.createElement("strong");
    name.textContent = login.name;
    const email = doc.createElement("code");
    email.textContent = login.email;
    const password = doc.createElement("code");
    password.textContent = login.password;
    const use = doc.createElement("button");
    use.type = "button";
    use.textContent = "Use";
    use.setAttribute("aria-label", `Use this login: ${login.name}`);
    use.setAttribute("data-testid", `demo-use-login-${i}`);
    use.addEventListener("click", () => {
      status.textContent = fillSignIn(login, doc)
        ? `${login.name}'s login is filled in. Tap Sign in.`
        : "Open the app's sign-in screen first (sign out to get back to it).";
    });
    const role = doc.createElement("span");
    role.className = "demo-role";
    role.textContent = "Operative";
    item.append(role, name, labelled("Email", email, doc), labelled("Password", password, doc), use);
    list.appendChild(item);
  });
  panel.append(summary, intro, list, status);
  return panel;
}

function labelled(label: string, value: HTMLElement, doc: Document): HTMLElement {
  const row = doc.createElement("span");
  row.append(`${label}: `, value);
  return row;
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
