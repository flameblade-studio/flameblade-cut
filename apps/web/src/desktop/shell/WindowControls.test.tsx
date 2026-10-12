import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { WindowControls } from "./WindowControls";

const win = { minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn(), isMaximized: vi.fn().mockResolvedValue(false) };

beforeEach(() => {
  (window as unknown as { openreel: unknown }).openreel = { platform: "desktop", win };
});
afterEach(() => {
  delete (window as unknown as { openreel?: unknown }).openreel;
  vi.clearAllMocks();
});

describe("WindowControls", () => {
  it("renders nothing on macOS (native traffic lights)", () => {
    const { container } = render(<WindowControls platform="darwin" />);
    expect(container.firstChild).toBeNull();
  });
  it("renders min/max/close on win32 and wires them", () => {
    render(<WindowControls platform="win32" />);
    fireEvent.click(screen.getByLabelText("Minimize"));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(win.minimize).toHaveBeenCalledTimes(1);
    expect(win.close).toHaveBeenCalledTimes(1);
  });

  // Regression: upstream always drew the "restore" glyph and never tracked state.
  it("shows Maximize when restored and Restore when maximized, following window events", async () => {
    let notify: ((maximized: boolean) => void) | undefined;
    const tracked = { ...win, onMaximizedChange: (cb: (maximized: boolean) => void) => ((notify = cb), () => undefined) };
    (window as unknown as { openreel: unknown }).openreel = { platform: "desktop", win: tracked };
    render(<WindowControls platform="win32" />);
    expect(await screen.findByLabelText("Maximize")).toBeTruthy();
    act(() => notify?.(true));
    expect(screen.getByLabelText("Restore")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Restore"));
    expect(win.toggleMaximize).toHaveBeenCalledTimes(1);
    act(() => notify?.(false));
    expect(screen.getByLabelText("Maximize")).toBeTruthy();
  });
});
