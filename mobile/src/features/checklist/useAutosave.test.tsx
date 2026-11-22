import { act, renderHook } from "@testing-library/react-native";
import { useAutosave } from "./useAutosave";

const ok = (raw: string) => ({ ok: true as const, value: raw.trim() === "" ? null : raw.trim() });

describe("useAutosave adopts a changed stored value only when nothing is pending", () => {
  it("shows the synced note when a pre-save snapshot was shown first (reopen after a kill, then the server copy arrives)", async () => {
    const commit = jest.fn();
    const { result, rerender } = await renderHook(({ stored }: { stored: string | null }) => useAutosave({ stored, validate: ok, commit }), { initialProps: { stored: null as string | null } });
    expect(result.current.text).toBe("");
    await rerender({ stored: "Synced note" });
    expect(result.current.text).toBe("Synced note");
    expect(commit).not.toHaveBeenCalled();
  });

  it("does not replace what the operative is typing", async () => {
    jest.useFakeTimers();
    try {
      const commit = jest.fn();
      const { result, rerender } = await renderHook(({ stored }: { stored: string | null }) => useAutosave({ stored, validate: ok, commit }), { initialProps: { stored: "a" as string | null } });
      await act(async () => result.current.onChange("a b"));
      await rerender({ stored: "server" });
      expect(result.current.text).toBe("a b");
      await act(async () => {
        jest.advanceTimersByTime(600);
      });
      expect(commit).toHaveBeenCalledWith("a b");
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not echo the operative's own committed value back over the text (trailing space kept)", async () => {
    const commit = jest.fn();
    const { result, rerender } = await renderHook(({ stored }: { stored: string | null }) => useAutosave({ stored, validate: ok, commit }), { initialProps: { stored: null as string | null } });
    await act(async () => result.current.onChange("Done "));
    await act(async () => result.current.flush());
    await rerender({ stored: "Done" });
    expect(result.current.text).toBe("Done ");
  });

  it("keeps a refused text on screen when the stored value changes", async () => {
    const validate = (raw: string) => (raw.length > 3 ? { ok: false as const, message: "Too long" } : ok(raw));
    const { result, rerender } = await renderHook(({ stored }: { stored: string | null }) => useAutosave({ stored, validate: validate as never, commit: jest.fn() }), { initialProps: { stored: null as string | null } });
    await act(async () => result.current.onChange("too long"));
    await rerender({ stored: "server" });
    expect(result.current.text).toBe("too long");
    expect(result.current.error).toBe("Too long");
  });
});
