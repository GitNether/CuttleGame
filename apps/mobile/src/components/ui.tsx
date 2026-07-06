import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { colors } from "../theme";

type BtnKind = "default" | "primary" | "warn";

export function Btn({
  title,
  onPress,
  kind = "default",
  small,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: BtnKind;
  small?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        kind === "primary" && styles.btnPrimary,
        kind === "warn" && styles.btnWarn,
        small && styles.btnSmall,
        disabled && { opacity: 0.45 },
        pressed && !disabled && { opacity: 0.8 },
        style,
      ]}
    >
      <Text
        style={[
          styles.btnText,
          kind === "primary" && styles.btnTextPrimary,
          small && { fontSize: 12 },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export const RowLabel = ({ children }: { children: React.ReactNode }) => (
  <Text style={styles.rowLabel}>{children}</Text>
);

export const Hint = ({ children, style }: { children: React.ReactNode; style?: object }) => (
  <Text style={[styles.hint, style]}>{children}</Text>
);

export const Notice = ({ children }: { children: React.ReactNode }) => (
  <View style={styles.notice}>
    <Text style={styles.noticeText}>{children}</Text>
  </View>
);

/** Legacy `.overlay > .modal` — a centered sheet over a dimmed backdrop. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose?: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
      <Pressable style={styles.modal} onPress={() => {}}>
          <Text style={styles.modalTitle}>{title}</Text>
          <ScrollView style={{ maxHeight: 480 }}>{children}</ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: colors.sea3,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  btnPrimary: { backgroundColor: colors.gold, borderColor: colors.goldDark },
  btnWarn: { backgroundColor: colors.warn, borderColor: colors.warnBorder },
  btnSmall: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 8 },
  btnText: { color: "#eaf6f4", fontSize: 14 },
  btnTextPrimary: { color: colors.goldText, fontWeight: "600" },
  rowLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    color: colors.label,
    marginTop: 6,
    marginBottom: 3,
  },
  hint: { fontSize: 13, color: colors.hint },
  notice: {
    backgroundColor: colors.noticeBg,
    borderColor: colors.noticeBorder,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  noticeText: { color: colors.noticeText, fontSize: 13 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(4,14,18,0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: 14,
  },
  modal: {
    backgroundColor: colors.sea,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    width: "100%",
    maxWidth: 560,
  },
  modalTitle: { fontSize: 19, color: colors.teal, fontWeight: "600", marginBottom: 8 },
});
