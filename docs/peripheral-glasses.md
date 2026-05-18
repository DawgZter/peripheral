# Peripheral Glasses

Peripheral is the hardware surface for the Agent Mode runtime. The glasses were built in Shenzhen as a lightweight display peripheral for real-world agents: 28g, microLED, binocular waveguide displays, 12-24 hours of battery life depending on operating mode, and an optical stack designed for extremely low light leakage.

The runtime treats the glasses as a consent and status surface, not as a phone-screen replacement. Agents can call, browse, email, pay, remember context, or ask for help, but they request semantic cards and widgets through the broker. The phone/runtime owns rendering, display leases, input focus, and the final decision about what appears.

## Hardware Profile

```sh
npm --prefix peripheral-hud-runtime run peripheralctl -- integrations hardware-profile --json
```

That command emits the same hardware profile used by the smoke tests:

- origin: Shenzhen-built agent-first display glasses
- weight: 28g
- optics: microLED binocular waveguide display
- display surface: 540x280, 2 bpp
- battery: 12-24 hours depending on operating mode
- privacy posture: extremely low light leakage by design

## Why Glasses

Peripheral is optimized for short, high-value moments:

- call status while AgentPhone works a real task
- transcript snippets that fit in a glance
- fullscreen approval cards when the agent needs consent
- quiet confirmation after email, memory, browser, or payment actions
- audit artifacts that prove what the wearer saw and decided

The glasses stay blank or minimal until the agent needs attention. That is the core product boundary: agents do useful work elsewhere, while Peripheral becomes the lightweight human control surface.
