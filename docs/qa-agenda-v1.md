# QA manuel Agenda V1 (10 min)

Goal: quick, reproducible pre-release check.

## Preconditions

- Logged in with a test owner account.
- At least one workspace exists.
- Start on `/dashboard`.

## Test matrix (12 tests)

1. **Create timed task from calendar slot**
   - Open Agenda calendar.
   - Click a timed slot.
   - Fill title + save.
   - Expected: event appears in the selected slot/time.

2. **Create all-day task**
   - Open draft from all-day row (or toggle all-day in modal).
   - Save.
   - Expected: event is rendered in all-day section.

3. **Toggle allDay timed -> all-day -> timed**
   - Open an existing draft/event.
   - Toggle allDay ON, save, reopen, toggle OFF, save.
   - Expected: date/time fields remain coherent, no invalid state.

4. **Edit startDate only**
   - Open an event.
   - Change start date/time only.
   - Save.
   - Expected: event moves correctly; due date remains valid.

5. **Edit dueDate only**
   - Open the same event.
   - Change due date/time only.
   - Save.
   - Expected: duration/end placement updates correctly.

6. **Display consistency: Calendar vs Planning**
   - In Agenda, switch `Calendrier` <-> `Planning`.
   - Expected: same item set visible, no missing event.

7. **Dashboard Favorites agenda visibility**
   - Mark one task as favorite.
   - Open Dashboard favorites agenda block.
   - Expected: favorite appears in Favorites agenda section.

8. **Non-favorite exclusion from Favorites agenda**
   - Ensure one non-favorite task exists.
   - Expected: non-favorite task is absent from Favorites agenda.

9. **FocusDate from Dashboard CTA**
   - Click "Voir calendrier" from dashboard agenda/favorites area.
   - Expected: navigates to Agenda and focuses correct date period.

10. **Timezone sanity with override**
    - Set `__SMARTNOTES_TEST_TIMEZONE__` (e.g. `Europe/Paris`) in test context.
    - Reload and inspect one known timed event.
    - Expected: displayed time matches forced timezone expectations.

11. **Mobile overflow sanity**
    - Emulate mobile width (or real device).
    - Navigate Dashboard + Agenda.
    - Expected: no horizontal overflow, no clipped controls.

12. **Mobile CTA access**
    - On mobile width, open empty states and creation flows.
    - Expected: primary CTAs are visible and tappable.

## Exit criteria

- 12/12 pass -> release candidate OK.
- Any fail -> block release, open fix PR, rerun this checklist.
