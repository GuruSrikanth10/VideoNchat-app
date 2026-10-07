// Modal dialogs built on the native <dialog> element, which handles focus
// trapping, Escape and the backdrop for us.

function build({ title, body, className = "" }) {
  const dialog = document.createElement("dialog");
  dialog.className = `dialog ${className}`.trim();
  const id = `dialog-title-${Math.random().toString(36).slice(2)}`;
  dialog.setAttribute("aria-labelledby", id);

  const form = document.createElement("form");
  form.method = "dialog";
  const heading = document.createElement("h2");
  heading.id = id;
  heading.className = "dialog__title";
  heading.textContent = title;
  form.append(heading);

  for (const paragraph of [body].flat().filter(Boolean)) {
    const p = document.createElement("p");
    p.className = "dialog__body";
    p.textContent = paragraph;
    form.append(p);
  }
  dialog.append(form);
  return { dialog, form };
}

function actions(form, buttons) {
  const row = document.createElement("div");
  row.className = "dialog__actions";
  for (const { label, value, tone = "secondary", autofocus } of buttons) {
    const button = document.createElement("button");
    button.className = `btn btn--${tone}`;
    button.value = value;
    button.textContent = label;
    if (autofocus) button.autofocus = true;
    row.append(button);
  }
  form.append(row);
}

function open(dialog, { onCancel } = {}) {
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.addEventListener("cancel", (event) => {
      if (onCancel === false) event.preventDefault(); // Escape not allowed
    });
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue);
      dialog.remove();
    });
    dialog.showModal();
  });
}

// Resolves to true if confirmed.
export async function confirmDialog({ title, body, confirmLabel, cancelLabel = "Cancel", tone }) {
  const { dialog, form } = build({ title, body });
  actions(form, [
    { label: cancelLabel, value: "cancel" },
    { label: confirmLabel, value: "confirm", tone: tone ?? "primary", autofocus: true },
  ]);
  return (await open(dialog)) === "confirm";
}

// Resolves to the chosen button's value ("" if dismissed with Escape).
export function choiceDialog({ title, body, choices }) {
  const { dialog, form } = build({ title, body });
  actions(form, choices);
  return open(dialog);
}
