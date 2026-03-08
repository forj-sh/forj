/**
 * DOM utility functions
 */

/**
 * Create an element with optional attributes and children
 */
export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes?: Record<string, string>,
  children?: (string | Node)[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);

  if (attributes) {
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'innerHTML') {
        element.innerHTML = value;
      } else {
        element.setAttribute(key, value);
      }
    });
  }

  if (children) {
    children.forEach((child) => {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else {
        element.appendChild(child);
      }
    });
  }

  return element;
}

/**
 * Parse HTML string into DOM element
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): HTMLElement {
  const htmlString = strings.reduce((result, str, i) => {
    return result + str + (values[i] ?? '');
  }, '');

  const template = document.createElement('template');
  template.innerHTML = htmlString.trim();
  return template.content.firstElementChild as HTMLElement;
}
