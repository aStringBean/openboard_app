import { useRef, useState, type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

/**
 * For screens whose inputs sit at the bottom, under a photo: when the
 * keyboard comes up, the whole screen lifts above it and whatever flexes (the
 * photo) gives way.
 *
 * The keyboard's position is on screen, the view's padding is relative to
 * itself, so the view must know how far down the screen it starts (below the
 * header). It measures that itself: the library's automaticOffset counted the
 * header twice under edge-to-edge, and the header's height is not public.
 */
export function LiftAboveKeyboard({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const ref = useRef<View>(null);
  const [top, setTop] = useState(0);

  return (
    <View
      ref={ref}
      style={[{ flex: 1 }, style]}
      onLayout={() => ref.current?.measureInWindow((_x, y) => setTop(Math.round(y)))}
    >
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={top} style={{ flex: 1 }}>
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
