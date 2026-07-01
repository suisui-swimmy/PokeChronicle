# Third-Party Notices

## projectpokemon/champout

PokeChronicle includes a compact generated battle template rule pack derived at development/build time from selected Japanese battle text files in the local `others/champout` checkout.

- Source: `projectpokemon/champout`
- Source commit: `d2885a864f041744df1de1b35f4ab3d2e52cf4db`
- Source files used: `rom-txt/jpn/btl_attack_syn.json`, `rom-txt/jpn/btl_std.json`
- Generated output: `data/generated/champout-event-rules.ja.json`
- License: MIT License

The app does not read `others/champout` at runtime. The full raw dump is not copied into the app bundle; only compact template rules selected for battle-event classification are generated and bundled.

```text
MIT License

Copyright (c) 2026 Kurt

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
