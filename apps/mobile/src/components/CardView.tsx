import { SUITS, isRed, rankStr, suitOf, type Card } from "@cuttle/engine";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

interface Props {
  id?: Card;
  onPress?: () => void;
  sel?: boolean;
  target?: boolean;
  small?: boolean;
  back?: boolean;
  glasses?: boolean; // rendered rotated, like the legacy sideways eight
}

export function CardView({ id, onPress, sel, target, small, back, glasses }: Props) {
  const w = small ? 40 : 54;
  const h = small ? 56 : 76;
  const box = [
    styles.card,
    { width: w, height: h },
    back && styles.back,
    sel && styles.sel,
    target && styles.target,
    glasses && { transform: [{ rotate: "90deg" }] },
  ];
  if (back || id == null) {
    return <View style={box}>{!small && <View style={styles.backStripe} />}</View>;
  }
  const red = isRed(id);
  const cornerStyle = [
    small ? styles.cornerTextSmall : styles.cornerText,
    { color: red ? colors.cardRed : colors.cardText },
  ];
  const inner = (
    <>
      <View style={styles.tl}>
        <Text style={cornerStyle}>{rankStr(id)}</Text>
        <Text style={cornerStyle}>{SUITS[suitOf(id)]}</Text>
      </View>
      <Text style={[small ? styles.midSmall : styles.mid, { color: red ? colors.cardRed : colors.cardText }]}>
        {SUITS[suitOf(id)]}
      </Text>
      <View style={styles.br}>
        <Text style={cornerStyle}>{rankStr(id)}</Text>
      </View>
    </>
  );
  if (onPress) {
    return (
      <Pressable style={({ pressed }) => [...box, pressed && styles.pressed]} onPress={onPress}>
        {inner}
      </Pressable>
    );
  }
  return <View style={box}>{inner}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 7,
    backgroundColor: colors.parch,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  back: {
    backgroundColor: colors.backLight,
    borderColor: "#0a2e38",
    overflow: "hidden",
  },
  backStripe: {
    flex: 1,
    margin: 5,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.backDark,
    backgroundColor: colors.backLight,
  },
  sel: {
    borderColor: colors.gold,
    borderWidth: 3,
    transform: [{ translateY: -4 }],
  },
  target: {
    borderColor: colors.coral,
    borderWidth: 3,
  },
  pressed: {
    transform: [{ translateY: -3 }],
  },
  tl: { position: "absolute", top: 3, left: 5 },
  br: { position: "absolute", bottom: 3, right: 5 },
  cornerText: { fontSize: 12, lineHeight: 13, fontWeight: "700", textAlign: "center" },
  cornerTextSmall: { fontSize: 10, lineHeight: 11, fontWeight: "700", textAlign: "center" },
  mid: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    textAlign: "center",
    textAlignVertical: "center",
    lineHeight: 74,
    fontSize: 26,
    fontWeight: "700",
  },
  midSmall: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    textAlign: "center",
    lineHeight: 54,
    fontSize: 17,
    fontWeight: "700",
  },
});
