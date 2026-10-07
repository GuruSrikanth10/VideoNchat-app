// Icons from the same-origin SVG sprite (public/icons.svg).
const NS = "http://www.w3.org/2000/svg";

export function icon(name, className = "icon") {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", `/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

export function setIcon(svg, name) {
  svg.querySelector("use").setAttribute("href", `/icons.svg#${name}`);
}

// Replaces every <svg data-icon="name"> placeholder in `root`.
export function hydrateIcons(root = document) {
  for (const placeholder of root.querySelectorAll("[data-icon]")) {
    const svg = icon(placeholder.dataset.icon, placeholder.getAttribute("class") || "icon");
    placeholder.replaceWith(svg);
  }
}
