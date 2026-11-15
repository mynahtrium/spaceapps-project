# NASA 3D model source

| File | NASA source | Fetched |
|---|---|---|
| `mark-iii-spacesuit.glb`, `mark-iii-spacesuit.png` | NASA Mark III / H-Suit textured 3D sculpture (`Mark+III.skp`, converted to multi-node textured glTF binary: 12 anatomical nodes, 20,692 opaque triangles, 3,046,952 bytes) — Max Grueter / NASA 3D Resources (`3D Models/Mark III Spacesuit`). Primary planetary EVA suit, rigged procedurally with inward palms and level symmetric boots in `web/hud/astronaut-rig.js`. | 2026-11-15 |
| `advanced-crew-escape-suit.glb` | NASA 3D Resources, Advanced Crew Escape Suit — https://science.nasa.gov/3d-resources/advanced-crew-escape-suit/ and https://github.com/nasa/NASA-3D-Resources (`3D Models/Advanced Crew Escape Suit/Advanced Crew Escape Suit.glb`, 858,408 bytes). Fallback suit mesh if Mark III fails to load. | 2026-11-14 |
| `mmsev-rover.glb` | NASA 3D Resources, Multi-Mission Space Exploration Vehicle (MMSEV) — https://github.com/nasa/NASA-3D-Resources | 2026-11-14 |
| `mars-2020-perseverance.glb` | NASA 3D Resources, `3D Models/Mars 2020 Perseverance Rover/Mars 2020 Perseverance Rover.glb` (Draco/glTF, NASA/JPL-Caltech) — https://github.com/nasa/NASA-3D-Resources | 2026-11-14 |

NASA 3D Resources are provided by NASA for public use under the NASA media usage guidelines (https://www.nasa.gov/nasa-brand-center/images-and-media/). The Mark III (H-Suit) is the primary hard-upper-torso planetary surface prototype (textured SKP sculpture by Max Grueter converted into 12 anatomical nodes for clean skinning). The Advanced Crew Escape Suit is the orange launch-and-entry suit kept as a fallback. Neither source file has a skeleton; both are scaled to 1.80 m and rigged procedurally in `web/hud/astronaut-rig.js`.

The Z2 suit (`3D Models/Z2 Spacesuit`, 16.9 MB) was tried but the download did not finish on 14 Nov 2026; it can be added later.
