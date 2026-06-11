/**
 * Haptic feedback for the mobile UI.
 *
 * iOS Safari exposes no vibration API, but toggling a native HTML switch
 * control (`<input type="checkbox" switch>`) via a `<label>` click fires real
 * Taptic Engine feedback on iOS 17.4+. We keep one visually-hidden switch in
 * the DOM and click it inside the user's gesture. Android falls back to
 * `navigator.vibrate`; everything else is a no-op.
 *
 * Must be called synchronously from a user gesture handler (e.g. onClick),
 * otherwise iOS ignores it.
 */

let hapticLabel: HTMLLabelElement | null = null;

function ensureHiddenSwitch(): HTMLLabelElement {
  if (hapticLabel?.isConnected) {
    return hapticLabel;
  }

  const label = document.createElement("label");

  label.setAttribute("aria-hidden", "true");
  label.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);pointer-events:none;opacity:0;";

  const input = document.createElement("input");

  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  hapticLabel = label;

  return label;
}

export function triggerHaptic() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(10);
  }

  try {
    ensureHiddenSwitch().click();
  } catch {
    // Haptics are best-effort; never let them break an interaction.
  }
}
