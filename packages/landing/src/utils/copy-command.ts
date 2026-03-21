/**
 * Copy the install command to clipboard and show brief feedback on the button.
 */
const COMMAND = 'npx forj-cli init';

export function bindCopyButton(btn: HTMLElement): void {
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const original = btn.textContent;
    try {
      await navigator.clipboard.writeText(COMMAND);
      btn.textContent = 'copied!';
    } catch {
      btn.textContent = COMMAND;
    }
    setTimeout(() => {
      btn.textContent = original;
    }, 1500);
  });
}
