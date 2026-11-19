import { readSoundEnabled } from "../settings";

export function soundSettingsHtml(): string {
  const on = readSoundEnabled();
  const pressed = on ? "true" : "false";
  const label = on ? "Sound on" : "Sound off";
  const aria = on ? "Settings, sound on" : "Settings, sound off";
  return `<li class="nav-settings" data-testid="sound-settings"><span class="nav-settings-kicker">Settings</span><button type="button" class="nav-link" data-sound-toggle data-testid="sound-toggle" aria-pressed="${pressed}" aria-label="${aria}">${label}</button></li>`;
}

export function paintSoundToggle(button: HTMLElement, enabled: boolean): void {
  button.setAttribute("aria-pressed", enabled ? "true" : "false");
  button.setAttribute(
    "aria-label",
    enabled ? "Settings, sound on" : "Settings, sound off",
  );
  button.textContent = enabled ? "Sound on" : "Sound off";
}
