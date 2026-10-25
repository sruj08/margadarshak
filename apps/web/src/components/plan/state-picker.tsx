"use client";

import { ComboBox, Input, ListBox } from "@heroui/react";
import { Home, Landmark, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { llTestAtHome, STATE_CODES, type StateCode } from "@/lib/journey/rules";

/**
 * State or UT picker: a searchable, fully styled combo box (the native select's open list is drawn
 * by the OS and cannot follow the design system). Each option says where the LL test happens there,
 * straight from that state's rule pack.
 */
export function StatePicker({
  value,
  onChange,
  labelledBy,
}: {
  value: StateCode;
  onChange: (code: StateCode) => void;
  labelledBy: string;
}) {
  const tc = useTranslations("common");
  const t = useTranslations("flow.statePicker");
  const items = useMemo(
    () =>
      STATE_CODES.map((code) => ({ code, name: tc(`state.${code}`), home: llTestAtHome(code) })),
    [tc],
  );
  return (
    <ComboBox
      fullWidth
      aria-labelledby={labelledBy}
      selectedKey={value}
      onSelectionChange={(k) => {
        if (k && (STATE_CODES as readonly string[]).includes(String(k))) onChange(k as StateCode);
      }}
      className="md-statepick"
      data-testid="plan-state"
    >
      <ComboBox.InputGroup className="md-statepick__group">
        <MapPin aria-hidden="true" className="md-statepick__pin" />
        <Input className="md-statepick__input" placeholder={t("search")} />
        <ComboBox.Trigger className="md-statepick__trigger" />
      </ComboBox.InputGroup>
      <ComboBox.Popover className="md-statepick__popover">
        <ListBox className="md-statepick__list">
          {items.map((s) => (
            <ListBox.Item
              key={s.code}
              id={s.code}
              textValue={s.name}
              className="md-statepick__item"
            >
              <span className="md-statepick__name">{s.name}</span>
              <span className="md-statepick__hint">
                {s.home ? <Home aria-hidden="true" /> : <Landmark aria-hidden="true" />}
                {s.home ? t("home") : t("rto")}
              </span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </ComboBox.Popover>
    </ComboBox>
  );
}
