import { useCallback, useEffect, useRef, useState } from "react";
import { TextInput, type TextInputProps } from "react-native";

type Props = Omit<TextInputProps, "value" | "defaultValue" | "onEndEditing" | "onSubmitEditing" | "onBlur"> & {
  /** The stored value. Followed when it changes, unless an edit is pending. */
  initial: string;
  onCommit: (text: string) => void;
  /**
   * "typing" saves shortly after typing stops — right for names. "done"
   * saves only when editing finishes — right for numbers, where "250" must
   * not pass through a committed "2" on the way.
   */
  commitWhile?: "typing" | "done";
};

const SETTLE_MS = 700;

/**
 * A text field that never loses an edit.
 *
 * Saving on onEndEditing alone is not enough on Android: closing the
 * keyboard with Back does not end editing, and leaving the screen then
 * throws the edit away. This saves on submit, blur and unmount as well — and,
 * for text, shortly after typing stops.
 */
export function CommitTextInput({ initial, onCommit, commitWhile = "typing", onChangeText, ...rest }: Props) {
  const [text, setText] = useState(initial);
  const committed = useRef(initial);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    if (pending.current !== null) return;
    committed.current = initial;
    setText(initial);
  }, [initial]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next !== null && next !== committed.current) {
      committed.current = next;
      commitRef.current(next);
    }
  }, []);

  /* Leaving the screen saves whatever is pending. */
  useEffect(() => flush, [flush]);

  return (
    <TextInput
      {...rest}
      value={text}
      onChangeText={(t) => {
        setText(t);
        pending.current = t;
        onChangeText?.(t);
        if (commitWhile === "typing") {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(flush, SETTLE_MS);
        }
      }}
      onEndEditing={flush}
      onSubmitEditing={flush}
      onBlur={flush}
    />
  );
}
