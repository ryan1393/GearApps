# Driver Phone Validation

Driver Phone at Guard Check-In is not generic required text.

## Check-In requirement

A valid value must:

- be present;
- contain only phone-number characters (`+`, digits, spaces, parentheses, periods, hyphens);
- contain between 7 and 15 actual digits.

Examples accepted:

```text
(260) 555-1212
260-555-1212
+1 260 555 1212
+44 20 7946 0958
```

Examples rejected:

```text
CALL DRIVER
555
260-FLOWERS
```

## Operator behavior

- input uses `type="tel"` and `inputmode="tel"`;
- invalid phone does not count toward the 11 required items;
- Check In & Print Slip remains disabled while invalid;
- clear validation text is shown;
- common 10-digit US values format as `(260) 555-1212`;
- 11-digit North-American values beginning with 1 format as `+1 (260) 555-1212`.

## API enforcement

The Nest API independently validates the phone so browser bypasses cannot save arbitrary text.

## Reusable Drivers

A Driver master record may still have no phone in Administration. At Check-In, however,
the visit cannot be saved until a valid Driver Phone is present. Selecting a reusable
driver with no phone therefore requires the guard to enter one; the successful visit
upserts that corrected/current phone into the reusable driver record.

## Scope

No database migration.
No schema change.
No workflow-state change.
No dependency change.
