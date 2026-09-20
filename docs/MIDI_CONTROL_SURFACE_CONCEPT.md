# MIDI & Control Surface Integration — Final Architecture Plan

**Status:** APPROVED FOR IMPLEMENTATION. Phase 4.97 architecture is locked; implementation begins with **Phase 4.97A — Control Surface Architecture Freeze & Live-Input Foundation**.

**Companion to:** `IMPLEMENTATION_PLAN_AUG_22.md` §7 Phase 4.97.

**Originally created:** 2026-09-07  
**Architecture revision approved:** 2026-09-17

---

## 1. Purpose

Visual Mood Lab is both a visual-authoring environment and a live-performance instrument. External control therefore cannot be treated as a small MIDI add-on. It needs to be a durable input system that can accept MIDI controllers, gamepads, and future hardware sources without changing how tiles themselves are authored.

The controller system must satisfy two very different workflows:

1. **Design / authoring:** a user can move a hardware control and write a useful visual value quickly and intuitively.
2. **Live performance:** a performer can use stable physical controls, multiple banks, pickup behavior, fan-out, pinned targets, and low-latency runtime control without generating database churn or destabilizing the render loop.

The existing schema-driven control system and modulation bus remain the foundation, but hardware input will not be forced through the modulation bus for every use case. The final architecture separates **direct control**, **modulation**, and **actions** while allowing all three to share the same device, target, persistence, and UI model.

---

## 2. Final settled decisions

These decisions are considered locked for Phase 4.97 unless real implementation evidence proves one unsafe or impossible.

| # | Decision | Final resolution |
|---|---|---|
| 1 | Core control model | **Three paths:** Direct, Modulation, and Action. Hardware is not only a modulation source. |
| 2 | Slot count | **8 visible controls per bank, not 8 total.** Data model supports unlimited banks. |
| 3 | Target scope for v1 | **Focused + Pinned.** Focused follows the currently open tile; Pinned stays attached to one designated tile. Global/board show-control is future work. |
| 4 | High-frequency writes | **Runtime override layer.** Hardware does not call normal persisted parameter setters on every incoming event. |
| 5 | Authoring behavior | **Live / Write mode.** Live is runtime-only. Write commits the final value after the gesture settles. |
| 6 | Fan-out | **Yes.** One physical control can target multiple parameters/actions. |
| 7 | Takeover | **Pickup default**, with Jump and Scaled alternatives per direct target. |
| 8 | Device model | **Device Profile → virtual controls/banks → VML targets.** Physical hardware identity is separated from tile assignments. |
| 9 | Bluetooth in v1 | **Pair at the operating-system level.** VML consumes devices exposed through Web MIDI or Gamepad APIs; no custom Web Bluetooth transport in the v1 critical path. |
| 10 | v1 transports | **Web MIDI + Gamepad.** WebHID / direct BLE transports are future adapters, not dependencies of 4.97. |
| 11 | UI placement | No new primary toolbar tab. **Modulate gets Signals / Controllers**, quick-bind appears next to eligible Inspector controls, and full device setup lives in Settings → Controllers. |
| 12 | MIDI scope | CC, Note On/Off, channel filtering, pitch bend, velocity, and common relative encoders. No SysEx in v1. |
| 13 | Gamepad scope | Standard mapping first, generic learn fallback, axes, buttons, analog triggers, inversion, calibration, and stick deadzones. |
| 14 | Fault isolation | MIDI is event-driven; gamepad polling is isolated from the shared renderer tick. Controller exceptions must never stop visual rendering. |
| 15 | Mapping portability | Versioned JSON mapping/profile import/export ships in v1 so users can back up and move hardware configurations. |

---

## 3. Core architecture: one control-surface system, three paths

The controller subsystem is generic from day one. MIDI and gamepads are transport adapters that feed normalized control signals into the same binding engine.

```text
MIDI / Gamepad / future HID
          │
          ▼
   DEVICE ADAPTERS
          │
          ▼
 NORMALIZED CONTROL SIGNALS
          │
          ▼
      BINDING ENGINE
       /      |       \
      /       |        \
 DIRECT   MODULATION   ACTION
    │          │          │
 live/base   existing    trigger / toggle /
 control     Mod Bus     reset / transport /
 override                future scene action
      \         |         /
       └──── TARGET REGISTRY ────┐
                                 ▼
                           RENDERER POOL
```

### 3.1 Direct path

Use when the physical control should behave like the visual control itself.

Examples:

- MIDI fader → Overall Scale
- Knob → Sphere Merge
- Gamepad trigger → VFX Mix
- Endless encoder → Rotation

A physical value is mapped into the target control's real range. Direct control does **not** use modulation Amount as its primary behavior.

### 3.2 Modulation path

Use when the hardware input should act as a signal around the target's current/base value.

Examples:

- Gamepad X axis subtly bends Distortion around its current value
- MIDI knob becomes a modulation source with adjustable Amount and Smoothing
- Multiple targets use the same virtual controller with different depths

This path deliberately reuses the existing Modulation system, including per-target Amount and Smoothing.

### 3.3 Action path

Use for event-style or state-change interactions.

Examples:

- MIDI pad → reseed / glitch trigger
- Gamepad button → toggle Auto Orbit
- Pad → reset VFX
- Button → next bank
- Future: blackout, scene recall, snapshot, transport action

Actions do not pretend to be continuous modulation.

---

## 4. Runtime value stack

The renderer must keep persisted values, live hardware state, and modulation separate.

```text
Persisted / Inspector Base Value
              ↓
   Live Controller Override
              ↓
        Modulation Layer
              ↓
      Effective Render Value
```

Example:

```text
Saved Overall Scale = 1.00
MIDI direct override = 1.65
Audio Bass modulation = ±0.20
Effective visual range ≈ 1.45–1.85
```

### Why this ordering matters

- Hardware can move the center/base position while LFO/audio modulation continues around it.
- Live control never permanently drags the stored parameter unless Write mode is explicitly enabled.
- Closing/reopening a tile still restores the intentional saved state rather than a random last modulation frame.
- High-rate input does not trigger the normal persistence/debounce/state-management path on every MIDI message or gamepad frame.

The controller subsystem therefore requires a dedicated **runtime override map** owned close to the renderer pool, not a stream of calls to the normal persisted `setParam()` path.

---

## 5. Input normalization

Do not flatten every device input into an anonymous 0..1 number too early. Preserve interaction semantics so endless encoders, sticks, buttons, triggers, and faders behave correctly.

```ts
type ControlSignal =
  | { kind: 'absolute'; value: number }      // 0..1: knob, fader, trigger
  | { kind: 'bipolar'; value: number }       // -1..1: stick, pitch bend
  | { kind: 'relative'; delta: number }      // encoder movement
  | { kind: 'gate'; pressed: boolean; velocity?: number }
  | { kind: 'trigger'; velocity?: number };
```

Every adapter converts raw hardware messages into one of these semantic signal types before bindings are evaluated.

### Transform pipeline

Continuous signals pass through a deterministic transformation chain:

```text
decode
  → calibrate
  → normalize
  → deadzone
  → invert
  → response curve
  → takeover / relative decode
  → smoothing
  → target scaling / quantization
  → dispatch
```

Discrete edges are handled separately so press/release ordering is never lost by continuous-event coalescing.

---

## 6. Typed physical source matchers

The original `controlIndex` concept is too weak for real hardware. A physical binding must describe what kind of input it matches.

```ts
type PhysicalControlMatcher =
  | {
      transport: 'midi';
      message: 'cc';
      channel?: number;
      cc: number;
      relativeMode?: 'absolute' | 'twos-complement' | 'binary-offset' | 'signed-bit';
    }
  | {
      transport: 'midi';
      message: 'note';
      channel?: number;
      note: number;
    }
  | {
      transport: 'midi';
      message: 'pitchbend';
      channel?: number;
    }
  | {
      transport: 'gamepad';
      input: 'axis';
      index: number;
    }
  | {
      transport: 'gamepad';
      input: 'button';
      index: number;
    };
```

This gives MIDI Learn and gamepad Learn a stable, transport-aware vocabulary instead of assuming every device exposes a simple numeric control index.

---

## 7. Device profiles, virtual controls, and banks

Hardware identity and tile targeting remain separate. This is essential for transferable muscle memory.

```text
PHYSICAL HARDWARE
        ↓
   DEVICE PROFILE
        ↓
 VIRTUAL CONTROLS / BANKS
        ↓
     VML TARGETS
```

### 7.1 Device Profile

A profile contains:

- profile id
- user-visible device alias
- best-effort device fingerprint
- transport type
- virtual banks
- physical matcher for each virtual control
- optional calibration metadata
- optional default relative-encoder mode

Device identity should use the best available composite fingerprint rather than relying only on a mutable display name. Suggested inputs include manufacturer, device name, transport, reported port/index information, and the user's own saved alias. Exact browser IDs are not assumed stable across every OS/replug scenario.

### 7.2 Eight controls per bank

The UI presents eight controls at a time because it is compact, readable, and matches common hardware layouts.

The architecture does **not** impose an eight-control total limit.

Example:

```text
Bank A — Knobs 1–8
Bank B — Knobs 9–16
Bank C — Pads 1–8
Bank D — Transport / utility
```

Banks may be changed from the UI and may themselves be bound to hardware actions later in the phase.

### 7.3 Learn from anywhere

Settings is not required for the common case.

Preferred quick workflow:

```text
Inspector control → Bind → “Move a control…” → turn knob → done
```

If no profile exists yet, VML creates the minimum required Device Profile entry in the background. Advanced users can rename, regroup, calibrate, or reorganize those controls later in Settings → Controllers.

---

## 8. Stable target registry

Bindings must not store only a `paramId`. They need enough identity to survive multiple scopes, effect instances, fan-out, and future board-level features.

```ts
type TargetScope = 'focused' | 'pinned' | 'global';

type TargetRef = {
  scope: TargetScope;
  cardId?: string;              // required for pinned targets
  domain: 'parameter' | 'effect' | 'action';
  controlId?: string;
  effectInstanceId?: string;
  actionId?: string;
};
```

### v1 exposed scopes

- **Focused** — follows whichever tile is currently open/focused.
- **Pinned** — remains attached to one specific tile even while the user opens another tile.

`global` is present in the vocabulary for forward compatibility but not exposed as general Show Control in v1.

### Why Pinned belongs in v1

Focused-only control becomes frustrating in a real performance as soon as the performer needs to inspect one tile while continuing to manipulate another. Pinned provides the minimum professional behavior without prematurely building a full scene/board automation system.

---

## 9. Binding model

A physical/virtual control can have one or more bindings. Each binding chooses a path and its own transform rules.

```ts
type ControllerBinding = {
  id: string;
  virtualControlId: string;
  path: 'direct' | 'modulation' | 'action';
  target: TargetRef;

  // continuous/direct
  takeover?: 'pickup' | 'jump' | 'scaled';
  smoothing?: number;
  invert?: boolean;
  curve?: 'linear' | 'log' | 'exp';

  // modulation
  amount?: number;

  // action
  actionMode?: 'trigger' | 'toggle' | 'momentary';
};
```

### Fan-out

Fan-out is represented by multiple bindings that share one `virtualControlId`. There is no special one-off fan-out subsystem.

That means one knob can simultaneously:

- directly control Scale,
- modulate Glitch Amount with a shallow depth,
- and drive an effect parameter,

provided the user intentionally creates those bindings.

---

## 10. Direct takeover behavior

A physical absolute control and a visual parameter are often at different positions when the binding becomes active. The default must prevent jumps.

### Pickup — default

The physical control is inactive until it crosses the current target value. At that point it takes ownership smoothly.

### Jump

The physical value takes effect immediately. Useful when instant absolute response is more important than continuity.

### Scaled

The remaining physical range is mapped from the current target value toward the appropriate endpoint. This avoids an immediate jump without requiring the control to cross through the current value.

### Relative controls

Endless encoders bypass absolute pickup logic and apply decoded deltas to the current runtime/base value. Common relative protocols are supported explicitly because auto-detection is not always reliable.

---

## 11. Live mode and Write mode

Controller mappings need two write behaviors because VML is both a live instrument and a visual design tool.

### LIVE — default for performance

- Updates runtime override state only.
- No database write per controller event.
- No high-frequency React/Zustand persistence churn.
- Removing the live override returns to the saved/base value.

### WRITE — authoring mode

- Hardware updates the live runtime value immediately.
- The final settled value is committed to the normal parameter state after a short inactivity/gesture window.
- Persistence is gesture-level, not event-level.
- The committed value becomes the new base value.

The UI should make the mode obvious near controller mappings, with LIVE as the safer performance default.

---

## 12. MIDI v1 behavior

### Supported input

- Control Change (CC)
- Note On / Note Off
- Note On with velocity 0 interpreted as Note Off
- Pitch Bend
- Per-binding or profile-level channel filtering
- Note velocity available to action/continuous mappings when useful
- Absolute and common relative encoder modes

### MIDI Learn filtering

Learn mode should ignore traffic that is not a useful user-operated control candidate, including MIDI Clock and Active Sensing. The parser may recognize such messages internally for diagnostics/future expansion, but they must not accidentally become learned controls.

### Not in v1

- SysEx
- MIDI output / LED feedback
- MIDI Clock synchronization of LFO/rate divisions

These can be added later without replacing the input architecture.

---

## 13. Gamepad v1 behavior

### Built-in path

Use the browser's Standard Gamepad Mapping when available. Expose familiar semantic controls such as:

- left stick X/Y
- right stick X/Y
- left/right trigger
- face buttons
- shoulder buttons
- D-pad
- stick buttons

### Generic fallback

Unknown controllers can still enter Learn mode using raw axis/button indices.

### Calibration

Per-profile calibration can store:

- center
- min/max observed range
- inversion
- deadzone
- response curve

For stick pairs, use **radial deadzones** so diagonal movement remains natural and the stick does not develop square/axis-biased behavior near center.

---

## 14. Bluetooth policy for v1

Visual Mood Lab does not implement custom Bluetooth pairing as part of the Phase 4.97 critical path.

Preferred flow:

1. Pair the controller through macOS / Windows / the host operating system.
2. The browser exposes it through Web MIDI or the Gamepad API.
3. VML discovers and learns it through the normal adapter.

This removes a separate Web Bluetooth permission and transport implementation from the first release while still covering normal Bluetooth gamepads and MIDI hardware that the operating system exposes to the browser.

A future BLE/WebHID adapter can plug into the same normalized input layer without changing bindings, targets, banks, or UI semantics.

---

## 15. UI structure

The current Visual Mood Lab layout remains the right structure. The controller system should extend it rather than create another major workspace.

### 15.1 Modulate panel

Replace the old proposed `Sources / Triggers` split with:

```text
SIGNALS | CONTROLLERS
```

**Signals** contains the existing LFO, audio, microphone, pointer, rate, Amount, and Smoothing workflow.

**Controllers** contains:

- active device/profile
- active bank
- virtual controls 1–8
- target list per control
- Direct / Modulation / Action mode
- Focused / Pinned target scope
- takeover mode where applicable
- Live / Write behavior
- `+ Add target`
- per-target remove/edit

### 15.2 Inspector quick-bind

Eligible controls receive a small controller/bind affordance.

Default appearance should remain visually quiet:

- hidden until hover/focus when unbound,
- visible as a small active badge/icon when mapped,
- shows a compact identifier such as `K3`, `P2`, or a controller glyph.

Quick workflow:

```text
Bind → move hardware → choose Direct / Modulation / Action if needed → done
```

The system should infer a sensible path where possible: sliders default Direct, triggers default Action, while Modulation remains an explicit option.

### 15.3 Controller status in app chrome

Add a small controller-status indicator rather than another toolbar tab.

It can show:

- number of connected controllers
- activity pulse
- current bank
- quick device/profile switch
- **Panic**

Panic must be accessible here because opening Settings during a live problem is too slow.

### 15.4 Settings → Controllers

Full setup and diagnostics live here:

- permission / capability state
- connected-device list
- device aliases and profiles
- bank editor
- MIDI channel defaults
- encoder mode defaults
- gamepad calibration
- raw activity monitor
- diagnostics
- mapping/profile import/export
- Panic

Do not expose a “Pair Bluetooth Device” requirement in the primary design. Standard Bluetooth pairing is handled by the operating system.

---

## 16. Persistence and portability

Hardware mappings should be versioned independently from tile parameter values.

```ts
type ControlSurfaceDocument = {
  schemaVersion: 1;
  profiles: DeviceProfile[];
  mappings: ControllerMapping[];
};
```

Persist:

- user aliases
- best-effort fingerprints
- physical matchers
- calibration
- banks / virtual controls
- bindings
- target scopes
- takeover modes
- transform settings
- Live/Write preference where appropriate

Do **not** persist transient runtime values such as current stick position, pickup armed state, held note state, or live override values.

### Import / export

Provide versioned JSON import/export in v1. A performer should be able to back up a working controller layout before a show, move it to another computer, or share a device mapping without rebuilding it manually.

Migrations must be tolerant of older schema versions rather than failing the whole controller subsystem.

---

## 17. Runtime scheduling and performance rules

### MIDI

MIDI is event-driven. Do not poll it.

### Gamepad

Gamepad state is polled in a dedicated controller `requestAnimationFrame` scheduler, created only while a gamepad is active/needed.

Do **not** place the gamepad poll loop inside the shared GL/renderer tick.

### Continuous-event coalescing

If several absolute/axis updates arrive before the next visual frame, keep the latest value for that source.

Example:

```text
CC74 = 10
CC74 = 18
CC74 = 27
CC74 = 32
[next render frame]
→ dispatch 32
```

This keeps the render side frame-aligned without processing redundant intermediate states.

### Discrete ordering

Note/button press and release edges must remain ordered. Never coalesce away a release event or a trigger edge.

### UI update throttling

The diagnostics/activity UI may update at a lower rate than the runtime controller engine. Hardware response must not depend on React rendering at controller event rate.

---

## 18. Fault containment, stability, and safety

The controller system is allowed to fail independently; the visual renderer is not.

Rules:

- every adapter boundary is wrapped defensively;
- malformed MIDI bytes are ignored/logged, never thrown into rendering;
- a disconnected device clears/neutralizes its active runtime state safely;
- a gamepad polling exception stops that device adapter, not the renderer pool;
- profile corruption falls back to an inactive mapping rather than applying unexpected controls;
- Panic clears held gates, latched actions, runtime overrides, pickup state, and other transient controller state;
- reconnect does not silently bind an obviously different device merely because a display name happens to match;
- no SysEx permission request in v1;
- controller APIs are only requested from explicit user interaction where the browser requires it.

---

## 19. Developer test tooling

Build controller testing before depending on physical hardware.

The mock surface should support:

- absolute CC sweep
- bipolar stick sweep
- relative encoder increments/decrements
- note/button press + release
- velocity values
- device connect/disconnect
- duplicate device names
- hot reconnect
- bank switching
- pickup crossing
- simulated malformed input

This allows the binding engine, persistence, UI, and failure paths to be verified deterministically before real-controller QA.

---

## 20. Revised Phase 4.97 implementation plan

### Phase 4.97A — Control Surface Architecture Freeze & Live-Input Foundation

**Goal:** establish the durable controller contract before building device-specific UX.

Build:

- `lib/control-surface/` module structure
- normalized `ControlSignal` model
- typed physical matchers
- versioned Device Profile / Bank / Virtual Control types
- stable `TargetRef` registry model
- Direct / Modulation / Action binding types
- Focused / Pinned target resolution contract
- runtime controller-override layer near the renderer pool
- Live / Write mode state contract
- controller source registry
- mock MIDI/gamepad test surface
- isolated scheduler abstraction for polled transports
- Panic/reset contract
- persistence serialization + migration foundation

**Important:** Phase 4.97A is architecture/foundation first. Do not prematurely build a polished MIDI Settings UI before the runtime contracts above are testable.

**4.97A exit gate:** mock absolute, bipolar, relative, gate, and trigger signals can be routed through the binding engine; Direct, Modulation, and Action dispatch are all represented; Focused and Pinned target resolution work; live overrides can affect a renderer without calling the normal persistence path every frame/event; Panic returns the system to a deterministic neutral/base state; typecheck/build remain clean.

---

### Phase 4.97B — MIDI Runtime & Device Management

Build:

- Web MIDI capability/permission flow
- MIDI device discovery
- connect/disconnect/hot-plug handling
- CC parser
- Note On/Off parser
- pitch bend
- velocity handling
- channel filtering
- relative encoder modes
- Learn candidate filtering
- device activity diagnostics
- reconnect matching / ambiguity handling
- Panic integration

**Exit gate:** a real MIDI controller can be connected, learned, disconnected, reconnected, and identified without affecting the render loop; all supported MIDI message classes produce normalized signals correctly.

---

### Phase 4.97C — Direct Control & Learn UX

Build:

- Inspector quick-bind
- Direct bindings
- Pickup / Jump / Scaled takeover
- relative-control direct edits
- runtime override rendering
- Live / Write mode behavior
- gesture-settle commit for Write mode
- fan-out
- Focused / Pinned UI
- active-binding indicators

**Exit gate:** a user can click a visual parameter, move a MIDI control, and operate that parameter with professional takeover behavior without visiting Settings.

---

### Phase 4.97D — Modulation Bridge

Build:

- virtual controller inputs as reusable Modulation sources
- per-target Amount and Smoothing
- Direct + Modulation coexistence ordering
- VFX parameter modulation parity
- controller-source labels/status inside Signals/Controllers UI
- modulation fan-out using the same virtual control

**Exit gate:** a hardware control can intentionally act as a modulation signal, including simultaneous targets with independent depths, while Direct mappings remain independent and predictable.

---

### Phase 4.97E — Gamepad Integration

Build:

- Gamepad capability detection
- dedicated gamepad polling scheduler
- Standard Gamepad Mapping profile
- generic axis/button Learn fallback
- analog trigger handling
- radial stick deadzones
- inversion
- calibration
- per-axis response curves
- multi-gamepad identity/selection
- reconnect/disconnect behavior

**Exit gate:** supported standard and generic gamepads can control Direct, Modulation, and Action targets without changing the shared binding architecture.

---

### Phase 4.97F — Banks, Presets & Portability

Build:

- 8-control-per-bank UI
- unlimited bank data model
- bank switching
- bank rename/reorder
- profile editor
- mapping preset save/load
- versioned JSON import/export
- conflict/error handling for imported mappings
- user aliases and profile management

**Exit gate:** a larger controller can expose more than eight controls cleanly through banks, and the entire configuration can be exported/imported without rebuilding mappings.

---

### Phase 4.97G — Live Production Hardening

Build/test:

- controller status indicator in app chrome
- quick Panic surface + shortcut
- Settings → Controllers diagnostics polish
- permission-denied / unsupported-browser states
- long-session memory and event-listener checks
- duplicate-controller-name scenarios
- reconnect during active performance
- controller flood/stress tests
- device removal while controls are held
- Focused/Pinned navigation stress
- render-performance measurements
- Performance Lock behavior where appropriate
- real hardware matrix QA

Recommended real-hardware QA matrix:

- conventional MIDI knob/fader controller
- MIDI pad controller
- controller with endless encoders if available
- Xbox-compatible gamepad
- PlayStation-compatible gamepad
- generic Bluetooth gamepad
- OS-exposed Bluetooth MIDI device if available

**Phase 4.97 exit gate:** Visual Mood Lab can be treated as a dependable live-controlled visual instrument: hardware mappings are fast, stable, recoverable, portable, and do not compromise the existing renderer budget or persistence model.

---

## 21. UI behavior by control kind

Recommended defaults when Quick Bind is used:

| VML control kind | Default hardware path | Notes |
|---|---|---|
| Slider | Direct | Modulation available as alternate |
| Stepper | Direct | Quantize to legal steps |
| XY | Direct pair or Modulation | Two-axis mapping supported by target sub-axis metadata |
| Toggle | Action / Toggle | Absolute direct mapping may be offered later if useful |
| Trigger | Action / Trigger | Press edge only by default |
| Select | Action / stepped Direct | Encoder/button cycling can be supported without pretending it is continuous |
| Color | Advanced / component target | Avoid a vague single scalar mapping; expose H/S/V or channel components if/when added |
| Vec3 | Advanced / component target | Map X/Y/Z individually |
| Text / Texture / Font | Not hardware-bindable by default | Keep unavailable unless a meaningful action model is defined |

The binding system should expose explicit sub-targets for compound controls rather than making one raw scalar mysteriously control a multi-value object.

---

## 22. Out of scope for Phase 4.97 v1, but architected for

- Full board/session **Show Control**
- scene launching / scene banks
- global master blackout/crossfade
- MIDI Clock / transport synchronization
- MIDI output and LED feedback
- custom Web Bluetooth transport
- WebHID adapter
- webcam / hand gesture adapter
- OSC / network control
- remote phone/tablet control surface
- motorized-fader feedback
- automatic controller scripting

All future transports should feed the same normalized signal and binding contracts rather than adding parallel parameter systems.

---

## 23. Definition of success

Phase 4.97 succeeds when all of the following are true:

1. A new user can bind a knob to a visual parameter in seconds without reading a manual.
2. A performer can use more than eight hardware controls through banks without relearning the device.
3. A controller can operate a focused tile or remain pinned to another tile during navigation.
4. Direct control feels like hardware ownership of the parameter, not like an LFO disguised as MIDI.
5. Hardware can also intentionally be used as a modulation source when desired.
6. Buttons/pads can fire discrete actions and fan out to multiple targets.
7. Pickup prevents surprise jumps by default.
8. Live control produces no high-frequency persistence churn.
9. Write mode can intentionally commit an authored value.
10. Device disconnect/reconnect and Panic produce deterministic recovery.
11. Gamepad polling and MIDI processing cannot crash or stall the renderer loop.
12. Mappings can be exported, imported, and migrated by schema version.
13. The architecture can add future transports without redesigning tile schemas.

---

## 24. Implementation start point

The approved build start is:

> **Phase 4.97A — Control Surface Architecture Freeze & Live-Input Foundation**

The first implementation sprint should focus only on the contracts and runtime foundation necessary for:

- **Direct + Modulation + Action** paths
- **8 controls per bank, unlimited banks in the model**
- **Focused + Pinned** target scopes
- **high-frequency runtime overrides**
- **Live / Write** behavior
- **Web MIDI + Gamepad** as the v1 transports
- **OS-level Bluetooth pairing** rather than custom BLE transport

Once the 4.97A exit gate is clean, device-specific implementation can proceed without needing to revisit the core control architecture.
