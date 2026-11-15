/**
 * NPC Roster, Specialized Vehicle Knowledge Bases & Offline Smart Q&A Engine (`web/hud/npc-knowledge.js`).
 *
 * Pure ES module (zero DOM or Three.js dependencies) powering the 7 Mars Habitat Bay NPCs
 * plus disabled placeholder definitions for future Pink Zone Corridor Screen NPCs.
 *
 * Scientific honesty & source commitments:
 *  - MSL RAD GCR baseline ~0.64 +/- 0.12 mSv/day (Hassler et al., Science 2014).
 *  - Gale gravity 3.717 m/s^2 (Lewis et al., 2019).
 *  - EVA 15-20 deg slope limits are illustrative lunar ConOps stand-ins; HiRISE DTM slope matches
 *    Curiosity rover tilt only weakly (~5 m medians 9.0 deg vs 8.6 deg), so safety margins apply.
 *  - Default Q&A executes 100% offline with zero network calls (`?demo=1` safe), while exposing a
 *    modular `registerNpcAiHook` for optional external LLM integration.
 */

import MiniSearch from "minisearch";

export const MARS_STATION_NPCS = Object.freeze([
  {
    id: "npc_active_rover",
    npcNumber: 1,
    name: "Cmdr. Alex Rivera",
    shortName: "Cmdr. Rivera",
    role: {
      en: "Active Rover & Surface Operations Specialist",
      tr: "Aktif Gezgin ve Yüzey Operasyonları Uzmanı",
    },
    tagText: "Cmdr. Rivera - Active Rover Specialist",
    accentHex: "#f59e0b",
    vehicleId: "mmsev",
    vehicleName: {
      en: "Current Active Rover (NASA MMSEV 6×6)",
      tr: "Mevcut Aktif Gezgin (NASA MMSEV 6×6)",
    },
    isDrivableVehicle: true,
    standoffDistM: 3.4,
    greeting: {
      en: "Welcome to the Rover Garage Bay! I'm Commander Alex Rivera, lead flight engineer on the Current Active Rover — our pressurized 6×6 NASA MMSEV. Step up beside the hull and press [E] anytime to drive it across Gale Crater.",
      tr: "Gezgin Garaj Bölmesine hoş geldin! Ben Komutan Alex Rivera, Mevcut Aktif Gezginimiz olan basınçlı 6×6 NASA MMSEV'in baş uçuş mühendisiyim. İstediğin zaman aracın yanına geçip [E] tuşuyla Gale Krateri'nde sürebilirsin.",
    },
    presets: [
      {
        id: "rover_overview",
        label: { en: "Tell me about this rover", tr: "Bana bu gezgini anlat" },
        question: {
          en: "Tell me about the Current Active Rover and its capabilities.",
          tr: "Mevcut Aktif Gezgin ve yetenekleri hakkında bilgi ver.",
        },
        answer: {
          en: "This is the Current Active Rover built around NASA's Multi-Mission Space Exploration Vehicle (MMSEV) architecture. Unlike uncrewed robotic labs, its ~1,850 kg cabin is pressurized so two crew members can conduct multi-day traverses in shirtsleeves, step directly into suitports when needed, and haul instruments across rugged basaltic regolith on six independent wheels.",
          tr: "Bu, NASA'nın Çok Amaçlı Uzay Keşif Aracı (MMSEV) mimarisi üzerine kurulu Mevcut Aktif Gezginimiz. İnsansız robot laboratuvarların aksine ~1.850 kg'lık kabini basınçlıdır; iki mürettebat üyesi uzun sürüşler yapabilir ve altı bağımsız tekerlekle engebeli regolit üzerinde bilimsel ekipman taşıyabilir.",
        },
      },
      {
        id: "rover_controls",
        label: { en: "How do I drive & control it?", tr: "Nasıl sürülür ve kontrol edilir?" },
        question: {
          en: "What are the controls for driving this rover and handling steep slopes?",
          tr: "Bu gezgini sürmek ve dik eğimlerle başa çıkmak için kontroller neler?",
        },
        answer: {
          en: "Walk up beside the MMSEV cabin and press [E] to board — my station stays anchored right here in the bay so you can safely test-drive out onto the surface! Drive with [W/S] throttle and [A/D] crab/Ackermann steering, hold [Shift] for electric torque boost, and tap [Space] for handbrake regolith drift. Keep traverses under 15°–20° (illustrative lunar ConOps stand-in limits), and keep a margin because HiRISE 1 m/5 m DTM slopes match actual rover tilt only weakly (~9.0° vs 8.6° median).",
          tr: "Araca binmek için MMSEV kabininin yanına gelip [E] tuşuna bas — ben istasyonumda sabit kalarak yüzey test sürüşünü takip ederim! [W/S] ile gaz/fren, [A/D] ile direksiyon, [Shift] ile tork takviyesi ve [Space] ile el freni drifti yapabilirsin. Eğimi 15°–20° altında (örnek Ay ConOps sınırları) tut ve HiRISE DTM eğimi ile gerçek eğim arasındaki zayıf eşleşme (~9.0° vs 8.6° medyan) nedeniyle her zaman güvenlik payı bırak.",
        },
      },
      {
        id: "rover_discovery",
        label: { en: "What science goal does it support?", tr: "Hangi bilim hedefini destekliyor?" },
        question: {
          en: "What is our primary science mission here at Gale Crater / Mount Sharp?",
          tr: "Gale Krateri / Mount Sharp'taki birincil bilim görevimiz nedir?",
        },
        answer: {
          en: "If a crew visited where Curiosity studied Mount Sharp, our primary objective would be investigating ancient lake sediments, mudstones, and habitability / biosignature potential (preserved organic molecules). The boxwork ridge-and-hollow formations of the Altadena member (Sol 4534+) make a compelling bonus stop along lower Mount Sharp.",
          tr: "Bir mürettebat Curiosity'nin Mount Sharp'ı incelediği bölgeyi ziyaret etseydi, birincil hedefimiz antik göl tortullarını, çamurtaşlarını ve yaşanabilirlik / biyo-iz potansiyelini (organik moleküller) incelemek olurdu. Altadena üyesindeki kafes (boxwork) sırtları ise ek bir bonus duraktır.",
        },
      },
      {
        id: "mars_fact",
        label: { en: "Tell me a fact about Mars", tr: "Mars hakkında bir gerçek söyle" },
        question: {
          en: "Tell me an essential operational fact about Mars gravity and radiation.",
          tr: "Mars yerçekimi ve radyasyonu hakkında önemli bir operasyonel gerçek söyle.",
        },
        answer: {
          en: "At Gale Crater, surface gravity averages 3.717 m/s² (~38% of Earth's), which changes wheel traction, braking distances, and jumping arcs dramatically. Meanwhile, Curiosity's RAD measured ~0.64 ± 0.12 mSv/day from galactic cosmic rays (Hassler et al., Science 2014) — radiation exposure is driven primarily by time in open terrain and solar particle events tracked via NASA DONKI.",
          tr: "Gale Krateri'nde yüzey yerçekimi ortalama 3,717 m/s²'dir (Dünya'nın ~%38'i); bu da tekerlek tutuşunu ve fren mesafesini doğrudan etkiler. Ayrıca Curiosity RAD aracı galaktik kozmik ışınlardan ~0,64 ± 0,12 mSv/gün ölçmüştür (Hassler et al. 2014) — radyasyon bütçesi esas olarak açık arazide geçirilen süre ve güneş olaylarıyla ilgilidir.",
        },
      },
    ],
    knowledge: {
      overview:
        "The Current Active Rover (NASA MMSEV 6×6) is an ~1,850 kg pressurized surface mobility platform with six independently sprung dual-wheel pods, front & rear coordinated steering, 4-stage EV drive gearing, and real-time suspension telemetry.",
      discoveries:
        "Built as a human-tended follow-on to MSL Curiosity in Gale Crater, the MMSEV enables crews to reach ancient lacustrine mudstone outcrops around lower Mount Sharp and bonus boxwork ridge targets while hauling heavier sampling drills and shielding mass than robotic scouts.",
      powerAndControls:
        "Powered by high-density rechargeable batteries fed by habitat solar/nuclear microgrids. Controls: [E] board/exit at hull, [W/S] drive/reverse, [A/D] steer, [Shift] boost, [Space] handbrake powerslide drift.",
      siteAndLongevity:
        "Staged at our Green Zone Rover Garage Bay in Gale Crater (~4.80°S, 137.39°E). Designed for multi-sol pressurized EVAs within safe 2 km walking/contingency corridors and slope limits of 15°–20° (lunar ConOps stand-ins).",
    },
  },

  {
    id: "npc_robo_concept",
    npcNumber: 2,
    name: "Dr. Lin Chen",
    shortName: "Dr. Chen",
    role: {
      en: "Next-Gen Autonomous & Concept Mobility Engineer",
      tr: "Yeni Nesil Otonom ve Konsept Mobilite Mühendisi",
    },
    tagText: "Dr. Chen - Mars Robo Concept Specialist",
    accentHex: "#38bdf8",
    vehicleId: "mars_robo_concept",
    vehicleName: {
      en: "NASA Mars Robo Concept",
      tr: "NASA Mars Robo Konsepti",
    },
    isDrivableVehicle: true,
    standoffDistM: 3.4,
    greeting: {
      en: "Hello explorer! I'm Dr. Lin Chen, principal architect for the NASA Mars Robo Concept parked right behind me. You can also board this concept platform with [E] — and don't worry, I'll hold position right here at the bay console to log your telemetry.",
      tr: "Merhaba kâşif! Ben Dr. Lin Chen, hemen arkamda park edilmiş NASA Mars Robo Konsepti'nin baş mimarıyım. Bu konsept araca da [E] tuşuyla binip sürebilirsin — ben bölmedeki yerimde sabit kalıp telemetrini kaydedeceğim.",
    },
    presets: [
      {
        id: "rover_overview",
        label: { en: "Tell me about this rover", tr: "Bana bu konsepti anlat" },
        question: {
          en: "Tell me about the NASA Mars Robo Concept and what makes it futuristic.",
          tr: "NASA Mars Robo Konsepti'ni ve onu gelecek nesil yapan özellikleri anlat.",
        },
        answer: {
          en: "The NASA Mars Robo Concept bridges robotic pathfinders and human expedition logistics. It features a lightweight titanium-composite deck (~620 kg dry), active-camber bionic suspension arms, an overhead stereo/LiDAR autonomy dome, and a rear robotic sample-manipulation arm for crew-assisted science.",
          tr: "NASA Mars Robo Konsepti, robotik öncüler ile insanlı keşif lojistiği arasında köprü kurar. Hafif titanyum-kompozit gövdeye (~620 kg), aktif kamberli biyonik süspansiyon kollarına, tepe LiDAR otonomi kubbesine ve mürettebat destekli arka numune koluna sahiptir.",
        },
      },
      {
        id: "rover_wheels",
        label: { en: "How do its wheels & suspension work?", tr: "Tekerlek ve süspansiyonu nasıl çalışır?" },
        question: {
          en: "Explain the futuristic wheel and suspension technology on this concept rover.",
          tr: "Bu konsept araçtaki gelecek nesil tekerlek ve süspansiyon teknolojisini açıkla.",
        },
        answer: {
          en: "Notice those open-weave metallic tires? They're inspired by NASA Glenn's superelastic Nickel-Titanium (Nitinol) shape-memory alloy spring tires! Unlike Curiosity's rigid aluminum cleats, which suffered punctures on sharp Gale Crater ventifacts, shape-memory spring mesh deforms around jagged rocks and snaps back elastically without bursting or losing traction.",
          tr: "Açık örgülü metalik lastikleri görüyor musun? Bunlar NASA Glenn'in süper-elastik Nitinol şekil hafızalı alaşımlı yaylı tekerleklerinden esinlendi! Keskin kayalarda delinme riski olan sert alüminyum tekerleklerin aksine, şekil hafızalı yay ağı kayaların etrafında esneyip anında eski formuna döner.",
        },
      },
      {
        id: "rover_human_assist",
        label: { en: "How does it assist astronauts?", tr: "Astronotlara nasıl yardım eder?" },
        question: {
          en: "How does this rover support future human-assisted Mars exploration?",
          tr: "Bu gezgin gelecekteki insan destekli Mars keşfine nasıl yardımcı olur?",
        },
        answer: {
          en: "Before astronauts ever risk a 15°–20° talus slope or boxwork ridge, the Mars Robo Concept scouts ahead using orbital HiRISE terrain priors plus onboard LiDAR, verifies ground-truth slope stability (important since orbital DTMs correlate only weakly with local rover tilt), pre-stages oxygen/tool caches, and can still be driven directly with [W/A/S/D] + [Space] drift when crew take manual override.",
          tr: "Astronotlar 15°–20°'lik dik bir yamaç veya kafes sırtına girmeden önce Mars Robo Konsepti HiRISE verisi ve yerleşik LiDAR ile önden keşif yapar, gerçek zemin eğimini doğrular, alet taşır ve gerektiğinde mürettebat tarafından [W/A/S/D] ile manuel kontrol edilebilir.",
        },
      },
      {
        id: "mars_fact",
        label: { en: "Tell me a fact about Mars", tr: "Mars hakkında bir gerçek söyle" },
        question: {
          en: "Tell me a fact about the Martian atmosphere and dust storms.",
          tr: "Mars atmosferi ve toz fırtınaları hakkında bir gerçek söyle.",
        },
        answer: {
          en: "Mars has an ultra-thin ~6.1 mbar atmosphere made of 95.3% carbon dioxide, so aerodynamic parachutes alone can't slow heavy human payloads — and high-velocity winds still loft micron-sized electrostatic dust. During regional or global dust storms, atmospheric optical depth (tau) can spike from ~0.5 to over 10, starving solar assets and cooling daytime highs.",
          tr: "Mars atmosferi yaklaşık ~6,1 mbar basıncındadır ve %95,3 karbondioksitten oluşur; bu yüzden paraşütler tek başına ağır yükleri yavaşlatamaz, ancak rüzgârlar ince elektrostatik tozu kaldırabilir. Küresel toz fırtınalarında optik derinlik (tau) ~0,5'ten 10'un üzerine çıkarak güneş enerjisini kesebilir.",
        },
      },
    ],
    knowledge: {
      overview:
        "The NASA Mars Robo Concept (~620 kg agile autonomy & human-teaming scout) pairs Nitinol shape-memory alloy spring tires, active independent suspension struts, 360° optical/LiDAR hazard mapping, and manual crew ride-along override.",
      discoveries:
        "Engineered specifically to scout high-value astrobiology targets like Mount Sharp boxwork ridges, muddy lacustrine strata, and steep crater-wall outcrops before committing suited astronauts.",
      powerAndControls:
        "Hybrid regenerative battery pack + thermal louver radiator deck for cold Martian nights. Press [E] near its chassis to take manual control ([W/S] drive, [A/D] all-wheel steer, [Shift] boost, [Space] powerslide).",
      siteAndLongevity:
        "Parked in the Green Zone Vehicle Spawn Bay alongside the active MMSEV so crews can test autonomous vs pressurized mobility side-by-side.",
    },
  },

  {
    id: "npc_sojourner",
    npcNumber: 3,
    name: "Dr. Haruto Sato",
    shortName: "Dr. Sato",
    role: {
      en: "Mars Pathfinder & Sojourner Historian",
      tr: "Mars Pathfinder ve Sojourner Tarihçisi",
    },
    tagText: "Dr. Sato - Sojourner Specialist",
    accentHex: "#ef4444",
    vehicleId: "sojourner",
    vehicleName: {
      en: "Sojourner (Mars Pathfinder, 1997)",
      tr: "Sojourner (Mars Pathfinder, 1997)",
    },
    isDrivableVehicle: false,
    standoffDistM: 2.4,
    greeting: {
      en: "Good sol! I'm Dr. Haruto Sato. Take a close look at Sojourner behind me — no bigger than a microwave oven, yet on July 4, 1997 it proved wheeled robotics could rove another planet.",
      tr: "İyi sollar! Ben Dr. Haruto Sato. Arkamdaki Sojourner'a yakından bak — bir mikrodalga fırın büyüklüğünde olmasına rağmen 4 Temmuz 1997'de başka bir gezegende tekerlekli keşfin mümkün olduğunu kanıtladı.",
    },
    presets: [
      {
        id: "rover_overview",
        label: { en: "Tell me about this rover", tr: "Bana bu gezgini anlat" },
        question: {
          en: "Tell me about Sojourner's 1997 Mars Pathfinder engineering and tiny size.",
          tr: "Sojourner'ın 1997 Mars Pathfinder mühendisliğini ve küçük boyutunu anlat.",
        },
        answer: {
          en: "Sojourner weighed just 10.6 kg on Earth (~4 kg in Mars gravity!) and measured only 0.65 m long by 0.48 m wide. Named after abolitionist Sojourner Truth, it launched inside the Pathfinder airbag lander, rolled down a ramp onto Ares Vallis, and pioneered the iconic 6-wheel rocker-bogie suspension system that Spirit, Opportunity, Curiosity, and Perseverance still trace their lineage to!",
          tr: "Sojourner Dünya'da yalnızca 10,6 kg ağırlığındaydı (Mars yerçekiminde ~4 kg!) ve 0,65 m uzunluğundaydı. Adını Sojourner Truth'tan alan araç, Pathfinder hava yastıklarıyla Ares Vallis'e indi ve sonraki tüm büyük NASA gezginlerinin atası olan 6 tekerlekli rocker-bogie süspansiyon sistemini ilk kez Mars'ta kanıtladı.",
        },
      },
      {
        id: "rover_discovery",
        label: { en: "What did it discover?", tr: "Neler keşfetti?" },
        question: {
          en: "What did Sojourner discover at Ares Vallis?",
          tr: "Sojourner, Ares Vallis'te neler keşfetti?",
        },
        answer: {
          en: "Using its Alpha Proton X-Ray Spectrometer (APXS) and stereo cameras, Sojourner analyzed famous boulders like 'Barnacle Bill', 'Yogi', and 'Scooby-Doo'. It found silicon-rich volcanic andesite rocks alongside water-rounded pebbles and sedimentary conglomerates — clear evidence that Ares Vallis had been sculpted by catastrophic ancient floods in a warmer, wetter Martian past.",
          tr: "Alfa Proton X-Işını Spektrometresi (APXS) ve stereo kameralarıyla 'Barnacle Bill' ve 'Yogi' gibi kayaları analiz etti. Silisyumca zengin andezit kayalarının yanı sıra akarsularla yuvarlanmış çakıllar bularak Ares Vallis'in antik dev taşkınlarla şekillendiğini gösterdi.",
        },
      },
      {
        id: "rover_power",
        label: { en: "How did it survive the cold?", tr: "Soğukta nasıl hayatta kaldı?" },
        question: {
          en: "How were Sojourner's electronics powered and kept warm on Mars?",
          tr: "Sojourner'ın elektronikleri Mars'ta nasıl güç aldı ve sıcak tutuldu?",
        },
        answer: {
          en: "That gold-foil box is the Warm Electronics Box (WEB), insulated with ultra-light silica aerogel and three tiny radioisotope heater units (RHUs) so its 2-megahertz Intel 80C85 flight computer wouldn't freeze at −100°C. A 0.22 m² gallium-arsenide (GaAs) solar deck plus non-rechargeable Li-SOCl₂ primary batteries kept it driving at ~0.01 m/s for 83 sols (vs a 7-sol planned mission) and ~100 meters!",
          tr: "Altın folyo kaplı Sıcak Elektronik Kutusu (WEB), silika aerojel yalıtımı ve üç küçük radyoizotop ısıtıcıyla −100°C gecelerde bile 2 MHz'lik işlemcisini korudu. Üstündeki 0,22 m² GaAs güneş paneli ve pillerle 7 sol hedeflenirken tam 83 sol (yaklaşık 100 m) çalıştı.",
        },
      },
      {
        id: "mars_fact",
        label: { en: "Tell me a fact about Mars", tr: "Mars hakkında bir gerçek söyle" },
        question: {
          en: "Tell me a fact about ancient Martian floods and landing zones.",
          tr: "Antik Mars taşkınları ve iniş bölgeleri hakkında bir gerçek söyle.",
        },
        answer: {
          en: "Outflow channels like Ares Vallis show flood discharge rates once rivaled or exceeded the flow of all Earth's rivers combined during catastrophic bursts from subsurface aquifers. And because Martian radio light-time ranges from 4 to 24 minutes one-way, even a tiny rover in 1997 needed onboard hazard-avoidance autonomy instead of live Earth joysticking!",
          tr: "Ares Vallis gibi taşkın kanalları, bir zamanlar yeraltı akiferlerinden Dünya'daki tüm nehirlerin toplamına denk ani sel akışları yaşandığını gösterir. Dünya-Mars arası tek yön radyo gecikmesi 4–24 dakika olduğundan, 1997'deki bu minik araç bile canlı kumanda yerine yerleşik engel kaçınma otonomisine güvenmek zorundaydı.",
        },
      },
    ],
    knowledge: {
      overview:
        "Sojourner (Mars Pathfinder, landed July 4, 1997 at Ares Vallis — 19.13°N, 326.78°E) was humanity's first wheeled vehicle on Mars: 10.6 kg, 0.65 m × 0.48 m × 0.30 m, 6-wheel rocker-bogie chassis.",
      discoveries:
        "APXS chemical analysis of rocks ('Barnacle Bill', 'Yogi') revealed silica-rich volcanic compositions plus rounded flood gravels indicating ancient liquid water runoff in Ares Vallis.",
      powerAndControls:
        "0.22 m² GaAs solar panel (~15 W peak) + non-rechargeable D-cell Li-SOCl₂ batteries + silica aerogel/RHU Warm Electronics Box; max speed ~1 cm/s.",
      siteAndLongevity:
        "Planned for 7 sols, operated 83 sols (~100 m total traverse) until contact with the Pathfinder base station ended in September 1997.",
    },
  },

  {
    id: "npc_spirit",
    npcNumber: 4,
    name: "Dr. Mara Kovács",
    shortName: "Dr. Kovács",
    role: {
      en: "Spirit (MER-A) Geoscience Specialist",
      tr: "Spirit (MER-A) Yerbilimleri Uzmanı",
    },
    tagText: "Dr. Kovács - Spirit Specialist",
    accentHex: "#fb923c",
    vehicleId: "spirit",
    vehicleName: {
      en: "Spirit — MER-A (2004–2010)",
      tr: "Spirit — MER-A (2004–2010)",
    },
    isDrivableVehicle: false,
    standoffDistM: 2.6,
    greeting: {
      en: "Welcome! I'm Dr. Mara Kovács, curator for Spirit (MER-A). Spirit landed in Gusev Crater expecting an obvious lakebed, found volcanic basalt instead — and then climbed mountains to uncover a hot-spring jackpot.",
      tr: "Hoş geldin! Ben Dr. Mara Kovács, Spirit (MER-A) uzmanı. Spirit, Gusev Krateri'nde kolay bir göl tabanı beklerken bazalt lavlarla karşılaştı — ama pes etmeyip tepelere tırmanarak antik kaplıcaların izini buldu.",
    },
    presets: [
      {
        id: "rover_overview",
        label: { en: "Tell me about this rover", tr: "Bana bu gezgini anlat" },
        question: {
          en: "Tell me about Spirit's design and its 2004 Gusev Crater mission.",
          tr: "Spirit'in tasarımını ve 2004 Gusev Krateri görevini anlat.",
        },
        answer: {
          en: "Spirit (MER-A) touched down on January 4, 2004 inside the 166 km Gusev Crater using giant tetrahedral airbags. Built as a 185 kg robotic field geologist with a 1.5 m Pancam/Mini-TES mast and an instrumented robotic arm (RAT rock grinder, Mössbauer, APXS, Microscopic Imager), Spirit turned a 90-sol prime mission into 2,208 sols and 7.73 km of rugged mountain climbing!",
          tr: "Spirit (MER-A), 4 Ocak 2004'te dev hava yastıklarıyla 166 km çapındaki Gusev Krateri'ne indi. 185 kg ağırlığındaki bu robotik jeolog, Pancam/Mini-TES direği ve kaya taşlayıcı/spektrometreli koluyla 90 solluk görevi 2.208 sole (7,73 km) taşıdı.",
        },
      },
      {
        id: "rover_discovery",
        label: { en: "What did it discover?", tr: "Neler keşfetti?" },
        question: {
          en: "What did Spirit discover in the Columbia Hills and at Home Plate?",
          tr: "Spirit, Columbia Tepeleri ve Home Plate'te neler keşfetti?",
        },
        answer: {
          en: "When Spirit's right-front wheel seized in 2006, driving backward dragged a trench through the soil near Home Plate — and accidentally churned up bright white deposits of >90% pure opaline silica! Combined with magnesium-iron carbonates at Comanche, that proved ancient volcanic hydrothermal hot springs and steam vents once bubbled at Gusev — a classic habitable energy source for microbial life.",
          tr: "2006'da Spirit'in sağ ön tekerleği kilitlenince geri geri sürülürken toprağı kazıdı ve Home Plate yakınında %90'dan fazla saflıkta parlak beyaz opalin silika ortaya çıkardı! Bu keşif, Gusev'de bir zamanlar antik hidrotermal kaplıcaların ve buhar bacalarının var olduğunu kanıtladı.",
        },
      },
      {
        id: "rover_longevity",
        label: { en: "How did solar power last 6+ years?", tr: "Güneş enerjisi 6 yılı aşkın süre nasıl dayandı?" },
        question: {
          en: "How did solar-powered Spirit survive 2,208 sols vs a 90-sol mission?",
          tr: "Güneş enerjili Spirit 90 solluk göreve rağmen nasıl 2.208 sol hayatta kaldı?",
        },
        answer: {
          en: "Engineers originally feared Martian dust would choke Spirit's 1.3 m² solar wings within 90 days. Instead, passing Martian dust devils swept the panels clean multiple times — jumping power output back above 80%! Spirit even scaled Husband Hill (+82 m climb) and survived harsh winters by parking tilted toward the northern sun before finally getting trapped in soft sulfate sand at 'Troy' in 2009.",
          tr: "Başlangıçta tozların 90 günde güneş panellerini kapatacağı düşünülüyordu. Ancak geçen toz şeytanları panelleri defalarca temizleyerek gücü %80'in üzerine çıkardı! Spirit Husband Tepesi'ne tırmandı ve sonunda 2009'da 'Troy' adlı yumuşak kum tuzağına saplanana dek 2.208 sol çalıştı.",
        },
      },
      {
        id: "mars_fact",
        label: { en: "Tell me a fact about Mars", tr: "Mars hakkında bir gerçek söyle" },
        question: {
          en: "Tell me a fact about Martian winds and dust devils.",
          tr: "Mars rüzgârları ve toz şeytanları hakkında bir gerçek söyle.",
        },
        answer: {
          en: "Even though Mars air has under 1% of Earth's sea-level pressure, intense daytime solar heating of dark basaltic sand drives convective vortices — dust devils — up to hundreds of meters tall! You can actually spot dust-devil plumes in our 3D Gale Crater atmosphere simulation, modeled alongside real Curiosity REMS pressure drops.",
          tr: "Mars havası Dünya'nın %1'inden ince olsa da, gündüz güneşinin koyu bazaltik kumu ısıtmasıyla yüzlerce metre yüksekliğe ulaşan toz şeytanları (konvektif girdaplar) oluşur! Bunların benzerlerini 3B Gale Krateri simülasyonumuzda da görebilirsin.",
        },
      },
    ],
    knowledge: {
      overview:
        "Spirit (MER-A, landed Jan 4, 2004 at Gusev Crater — 14.57°S, 175.48°E) was a 185 kg solar-powered 6×6 rover that drove 7.73 km across crater plains and climbed into the Columbia Hills.",
      discoveries:
        "Uncovered near-pure opaline silica (~90% SiO₂) at Home Plate, Fe/Mg-carbonates at Comanche, and altered volcanic tuff — compelling evidence for ancient Mars hydrothermal hot-spring activity.",
      powerAndControls:
        "Deployable triple-junction solar arrays + rechargeable Li-ion batteries (~140 W·h/sol), 6-wheel rocker-bogie suspension with 4-wheel steering after front-right actuator failure.",
      siteAndLongevity:
        "Planned for 90 sols; lasted 2,208 sols (more than 6 Earth years), saved repeatedly by passing dust-cleaning wind events until entrapment at Troy in 2009 and final contact March 22, 2010.",
    },
  },

  {
    id: "npc_opportunity",
    npcNumber: 5,
    name: "Dr. Kwame Mensah",
    shortName: "Dr. Mensah",
    role: {
      en: "Opportunity (MER-B) Endurance Specialist",
      tr: "Opportunity (MER-B) Dayanıklılık Uzmanı",
    },
    tagText: "Dr. Mensah - Opportunity Specialist",
    accentHex: "#facc15",
    vehicleId: "opportunity",
    vehicleName: {
      en: "Opportunity — MER-B (2004–2018)",
      tr: "Opportunity — MER-B (2004–2018)",
    },
    isDrivableVehicle: false,
    standoffDistM: 2.6,
    greeting: {
      en: "Greetings! I'm Dr. Kwame Mensah. Before you stands Opportunity (MER-B) — the planetary marathon champion that turned a 90-day sprint into an epic 15-year, 45.16 km trek across Meridiani Planum.",
      tr: "Selamlar! Ben Dr. Kwame Mensah. Önünde duran Opportunity (MER-B), 90 günlük bir görevi tam 15 yıllık ve 45,16 km'lik tarihi bir Meridiani Planum maratonuna dönüştüren efsanevi gezgindir.",
    },
    presets: [
      {
        id: "rover_overview",
        label: { en: "Tell me about this rover", tr: "Bana bu gezgini anlat" },
        question: {
          en: "Tell me about Opportunity's record-breaking 15-year mission at Meridiani Planum.",
          tr: "Opportunity'nin Meridiani Planum'daki rekor kıran 15 yıllık görevini anlat.",
        },
        answer: {
          en: "Opportunity (MER-B) made a 'hole-in-one' airbag landing inside 22-meter Eagle Crater on January 25, 2004 (1.95°S, 354.47°E). Originally budgeted for 90 sols and ~600 meters, Oppy explored Eagle, Endurance, Victoria, and Endeavour craters over 5,111 Martian sols (nearly 15 Earth years) — logging an off-world driving record of 45.16 km!",
          tr: "Opportunity (MER-B), 25 Ocak 2004'te Eagle Krateri'nin tam içine tarihi bir iniş yaptı. Başlangıçta 90 sol ve ~600 m için planlanan görev tam 5.111 sol (yaklaşık 15 Dünya yılı) sürdü ve araç 45,16 km yol kat ederek dünya dışı sürüş rekorunu kırdı.",
        },
      },
      {
        id: "rover_discovery",
        label: { en: "What are Martian 'blueberries'?", tr: "Mars 'yaban mersinleri' (blueberries) nedir?" },
        question: {
          en: "What did Opportunity discover about hematite 'blueberries' and ancient water?",
          tr: "Opportunity hematit 'yaban mersinleri' ve antik su hakkında ne keşfetti?",
        },
        answer: {
          en: "Right in Eagle Crater's bedrock, Opportunity spotted thousands of millimeter-sized gray spheres embedded like blueberries in a muffin! Its Mössbauer and APXS spectrometers proved they were iron-rich hematite concretions precipitated from acidic salty groundwater, surrounded by cross-bedded jarosite sulfates — and later at Endeavour Crater's rim it found benign, neutral-pH smectite clays friendly to life!",
          tr: "Opportunity, Eagle Krateri anakayasında kek içindeki yaban mersinlerine benzeyen binlerce gri kürecik buldu! Spektrometreler bunların tuzlu yeraltı suyunda çökelmiş hematit yumruları olduğunu gösterdi; yıllar sonra Endeavour Krateri kenarında ise yaşam için çok daha elverişli nötr-pH kil mineralleri buldu.",
        },
      },
      {
        id: "rover_storm",
        label: { en: "How did the mission end?", tr: "Görevi nasıl sona erdi?" },
        question: {
          en: "How did the 2018 global dust storm affect Opportunity?",
          tr: "2018 küresel toz fırtınası Opportunity'yi nasıl etkiledi?",
        },
        answer: {
          en: "In June 2018 a planet-encircling dust storm engulfed Perseverance Valley. Atmospheric opacity (tau) exploded past 10.8 — turning Martian noon darker than midnight — choking Opportunity's solar wings and plunging electronics below survivability thresholds. After Sol 5111's final telemetry, NASA engineers transmitted over 1,000 recovery commands before bidding Oppy farewell in February 2019.",
          tr: "Haziran 2018'de tüm gezegeni saran bir toz fırtınası Perseverance Vadisi'ni kapladı. Atmosferik opaklık (tau) 10,8'in üzerine çıkarak gündüzü geceye çevirdi ve güneş panellerini devre dışı bıraktı. Sol 5111'deki son verinin ardından NASA, Şubat 2019'da Opportunity ile vedalaştı.",
        },
      },
      {
        id: "mars_fact",
        label: { en: "Tell me a fact about Mars", tr: "Mars hakkında bir gerçek söyle" },
        question: {
          en: "Why are Opportunity's global dust storms important for human planners?",
          tr: "Opportunity'yi durduran küresel toz fırtınaları insanlı görevler için neden önemlidir?",
        },
        answer: {
          en: "Global dust storms prove why future Mars bases can't rely solely on solar panels without nuclear backup or massive energy storage. Even at a 'sunny' equatorial site like Meridiani Planum, optical depth can cut surface solar flux by >99% for weeks — which is also why orbital THEMIS thermal data and REMS weather history help us choose sheltered EVA windows.",
          tr: "Küresel toz fırtınaları, gelecekteki Mars üslerinin neden nükleer yedekleme veya dev enerji depolaması olmadan yalnızca güneş enerjisine güvenemeyeceğini kanıtlar. Ekvatoral bir bölgede bile haftalarca güneş ışığının %99'dan fazlası kesilebilir.",
        },
      },
    ],
    knowledge: {
      overview:
        "Opportunity (MER-B, twin of Spirit, landed Jan 25, 2004 at Meridiani Planum — 1.95°S, 354.47°E): 185 kg solar-powered rover holding the 45.16 km Mars surface distance milestone across 5,111 sols.",
      discoveries:
        "Proved Mars once hosted persistent liquid water via gray hematite 'blueberries' (concretions), sulfate cross-bed ripples (Burns formation), jarosite, and older neutral-pH smectite clay veins at Endeavour Crater.",
      powerAndControls:
        "Solar arrays (~140 W·h/sol nominal) + Li-ion batteries; drove >45 km with 6-wheel rocker-bogie chassis despite aging steering actuators.",
      siteAndLongevity:
        "Operated nearly 15 Earth years (5,111 sols vs 90-sol planned lifetime) until the June 2018 global dust storm blocked sunlight (tau > 10.8).",
    },
  },

  {
    id: "npc_curiosity",
    npcNumber: 6,
    name: "Dr. Samir Patel",
    shortName: "Dr. Patel",
    role: {
      en: "Curiosity (MSL) Gale Crater & Mount Sharp Specialist",
      tr: "Curiosity (MSL) Gale Krateri ve Mount Sharp Uzmanı",
    },
    tagText: "Dr. Patel - Curiosity Specialist",
    accentHex: "#22c55e",
    vehicleId: "curiosity",
    vehicleName: {
      en: "Curiosity — MSL (2012–Present)",
      tr: "Curiosity — MSL (2012–Günümüz)",
    },
    isDrivableVehicle: false,
    standoffDistM: 2.9,
    greeting: {
      en: "Welcome to Curiosity's home crater! I'm Dr. Samir Patel. Our entire Martian Map EVA scenario asks: what if human explorers walked the very Gale Crater / Mount Sharp strata Curiosity has studied since 2012?",
      tr: "Curiosity'nin kendi kraterine hoş geldin! Ben Dr. Samir Patel. Tüm bu harita ve EVA senaryomuzun kalbinde Curiosity'nin 2012'den beri Gale Krateri ve Mount Sharp'ta incelediği antik göl yatakları yatıyor.",
    },
    presets: [
      {
        id: "rover_overview",
        label: { en: "Tell me about this rover", tr: "Bana bu gezgini anlat" },
        question: {
          en: "Tell me about Curiosity's Gale Crater mission, size, and RTG nuclear power.",
          tr: "Curiosity'nin Gale Krateri görevini, boyutunu ve nükleer RTG gücünü anlat.",
        },
        answer: {
          en: "Curiosity (MSL) is a 899 kg SUV-sized mobile analytical laboratory lowered onto Bradbury Landing (4.59°S, 137.44°E) by the famous Sky Crane in August 2012. Unlike solar rovers, its Multi-Mission Radioisotope Thermoelectric Generator (MMRTG) uses decaying Plutonium-238 to deliver steady power day and night — even through global dust storms — across more than 5,000 sols climbing Mount Sharp (Aeolis Mons)!",
          tr: "Curiosity (MSL), Ağustos 2012'de Sky Crane sistemiyle Gale Krateri'ne indirilen 899 kg'lık bir mobil laboratuvardır. Güneş panelli araçların aksine MMRTG nükleer güç kaynağı (Plütonyum-238), gece gündüz ve toz fırtınalarında kesintisiz elektrik üreterek Mount Sharp tırmanışını 5.000 solun ötesine taşıdı.",
        },
      },
      {
        id: "rover_discovery",
        label: { en: "What did it discover?", tr: "Neler keşfetti?" },
        question: {
          en: "What did Curiosity discover about ancient lakes, organics, and boxwork on Mount Sharp?",
          tr: "Curiosity antik göller, organikler ve Mount Sharp boxwork yapıları hakkında neler keşfetti?",
        },
        answer: {
          en: "Curiosity hit astrobiological paydirt early at Yellowknife Bay mudstones: clay minerals plus all key CHNOPS elements (sulfur, nitrogen, hydrogen, oxygen, phosphorus, carbon) proving a neutral-pH freshwater lake persisted for millions of years — genuinely habitable! SAM later detected complex organic carbon molecules in mudstones, and since Sol 4534 (May 2025) Curiosity entered the Altadena member's boxwork unit (~5 m phyllosilicate ridges enclosing 10–20 m siderite hollows)!",
          tr: "Curiosity, Yellowknife Bay çamurtaşlarında yaşam için gereken temel elementleri ve kil minerallerini bularak burada milyonlarca yıl süren yaşanabilir bir tatlı su gölü olduğunu kanıtladı! SAM laboratuvarı organik karbon molekülleri tespit etti ve Sol 4534'ten itibaren Altadena üyesindeki boxwork (kafes sırt ve siderit çukurları) birimini incelemeye başladı.",
        },
      },
      {
        id: "rover_rad_rems",
        label: { en: "What did RAD & REMS measure here?", tr: "RAD ve REMS burada ne ölçtü?" },
        question: {
          en: "Tell me about Curiosity's REMS weather and RAD radiation measurements for astronauts.",
          tr: "Curiosity'nin REMS hava durumu ve RAD radyasyon ölçümleri astronotlar için ne söylüyor?",
        },
        answer: {
          en: "Curiosity's Radiation Assessment Detector (RAD) gave human mission planners our gold-standard ground truth: ~0.64 ± 0.12 mSv/day galactic cosmic-ray dose equivalent at Gale Crater (~−4.4 km MOLA, Hassler et al. 2014). That's why our EVA planner computes dose from duration rather than pretending rocks are radioactive — plus REMS weather logs daily Gale pressure (~7–9 mbar) and winds!",
          tr: "Curiosity'nin RAD dedektörü, insanlı görev planlayıcılarına ilk kez gerçek Mars yüzey radyasyon verisini sundu: Gale Krateri'nde galaktik kozmik ışınlardan ~0,64 ± 0,12 mSv/gün (Hassler et al. 2014). REMS ise Gale'deki günlük basınç (~7–9 mbar) ve sıcaklık değişimlerini ölçer.",
        },
      },
      {
        id: "mars_fact",
        label: { en: "Tell me a fact about Mars", tr: "Mars hakkında bir gerçek söyle" },
        question: {
          en: "Tell me a fact about Mount Sharp and HiRISE terrain mapping.",
          tr: "Mount Sharp ve HiRISE arazi haritalaması hakkında bir gerçek söyle.",
        },
        answer: {
          en: "Mount Sharp (Aeolis Mons) rises ~5.5 km from Gale Crater's floor — preserving a vertical geologic library from ancient lake clays up into salty sulfate layers. In our HiRISE 1 m DTM check (`DTEEC_019698`), note that orbital DTM slopes only weakly match local Curiosity rover tilts (5 m medians 9.0° vs 8.6°), and 1 m cells barely resolve ~5 m boxwork ridges, so crews must inspect 25 cm orthophotos too!",
          tr: "Mount Sharp (Aeolis Mons), Gale Krateri tabanından ~5,5 km yükselerek antik göl killerinden sülfat katmanlarına uzanan jeolojik bir zaman kapsülü sunar. HiRISE DTM kontrollerimizde yörünge eğiminin gerçek gezgin eğimiyle zayıf eşleştiği görüldüğünden, ~5 m'lik sırtlar için 25 cm ortofotolar da incelenmelidir.",
        },
      },
    ],
    knowledge: {
      overview:
        "Curiosity (MSL, landed Aug 6, 2012 at Bradbury Landing in Gale Crater — 4.59°S, 137.44°E): 899 kg nuclear MMRTG-powered chemistry & geology lab ascending Mount Sharp past Sol 5070 (~4.83°S, 137.39°E).",
      discoveries:
        "Confirmed ancient habitable freshwater lakes in Yellowknife Bay mudstones, organic carbon molecules (SAM), methane seasonality, boron veins, and boxwork phyllosilicate ridges / siderite hollows in the Altadena member (Sol 4534+).",
      powerAndControls:
        "Plutonium-238 MMRTG (~110 W electric continuous, recharging two Li-ion batteries); 17 cameras, ChemCam LIBS laser, SAM & CheMin labs, RAD dosimeter (0.64 ± 0.12 mSv/day GCR), REMS weather.",
      siteAndLongevity:
        "Over 5,070 sols (>14 Earth years) active in Gale Crater/Mount Sharp (~33+ km driven), directly inspiring the primary mudstone/organics + bonus boxwork route in this planner.",
    },
  },

  {
    id: "npc_perseverance",
    npcNumber: 7,
    name: "Dr. Elena Vega",
    shortName: "Dr. Vega",
    role: {
      en: "Perseverance & Jezero Astrobiology Specialist",
      tr: "Perseverance ve Jezero Astrobiyoloji Uzmanı",
    },
    tagText: "Dr. Vega - Perseverance Specialist",
    accentHex: "#a855f7",
    vehicleId: "perseverance",
    vehicleName: {
      en: "Perseverance — Mars 2020 (2021–Present)",
      tr: "Perseverance — Mars 2020 (2021–Günümüz)",
    },
    isDrivableVehicle: false,
    standoffDistM: 2.9,
    greeting: {
      en: "Hi there! I'm Dr. Elena Vega, astrobiology lead for Perseverance. While Curiosity proved Gale Crater could sustain life, Perseverance is hunting ancient biosignatures in Jezero's delta — and caching sealed core samples for return to Earth!",
      tr: "Merhaba! Ben Dr. Elena Vega, Perseverance astrobiyoloji sorumlusuyum. Curiosity Gale Krateri'nin yaşanabilir olduğunu kanıtladıktan sonra, Perseverance şimdi Jezero deltasında antik yaşam izleri arıyor ve Dünya'ya dönüş için kaya örnekleri mühürlüyor.",
    },
    presets: [
      {
        id: "rover_overview",
        label: { en: "Tell me about this rover", tr: "Bana bu gezgini anlat" },
        question: {
          en: "Tell me about Perseverance's Jezero Crater mission and upgraded hardware.",
          tr: "Perseverance'ın Jezero Krateri görevini ve geliştirilmiş donanımını anlat.",
        },
        answer: {
          en: "Perseverance (Mars 2020, 1,025 kg) landed on February 18, 2021 at Octavia E. Butler Landing in Jezero Crater (18.44°N, 77.45°E) using Terrain-Relative Navigation. While sharing Curiosity's Sky Crane + MMRTG pedigree, Percy packs tougher narrow-cleated aluminum wheels, an ultra-clean rotary percussive coring drill, 43 titanium sample tubes, RIMFAX subsurface radar, MOXIE, and a belly bay that carried Ingenuity!",
          tr: "Perseverance (1.025 kg), 18 Şubat 2021'de Araziye Göreli Navigasyon (TRN) ile Jezero Krateri'ne indi. Curiosity'nin MMRTG mimarisini geliştirerek daha dayanıklı tekerlekler, 43 titanyum numune tüpü, RIMFAX yeraltı radarı, MOXIE oksijen üreteci ve Ingenuity helikopterini taşıdı.",
        },
      },
      {
        id: "rover_discovery",
        label: { en: "What did it discover?", tr: "Neler keşfetti?" },
        question: {
          en: "What has Perseverance found in Jezero's delta and sample-caching campaign?",
          tr: "Perseverance Jezero deltasında ve numune toplama kampanyasında neler buldu?",
        },
        answer: {
          en: "Perseverance confirmed Jezero's fan was a genuine river-delta emptying into an ancient crater lake, mapped layered clay/carbonate shoreline sediments with PIXL & SHERLOC, detected organic molecules alongside intriguing redox/leopard-spot textures in rocks like 'Cheyava Falls' in Neretva Vallis, and built the Three Forks sample depot of hermetically sealed rock cores awaiting Mars Sample Return!",
          tr: "Perseverance, Jezero yelpazesinin antik bir göle dökülen gerçek bir nehir deltası olduğunu doğruladı, PIXL ve SHERLOC ile kil/karbonat katmanlarını ve 'Cheyava Falls' gibi ilginç benekli kayaları inceledi ve Dünya'ya gönderilmek üzere sızdırmaz titanyum tüplerde kaya çekirdekleri depoladı.",
        },
      },
      {
        id: "rover_ingenuity_moxie",
        label: { en: "Tell me about Ingenuity & MOXIE", tr: "Ingenuity ve MOXIE hakkında bilgi ver" },
        question: {
          en: "How did Ingenuity fly on Mars and how did MOXIE make oxygen?",
          tr: "Ingenuity Mars'ta nasıl uçtu ve MOXIE nasıl oksijen üretti?",
        },
        answer: {
          en: "Ingenuity achieved the first powered, controlled aerodynamic flight on another world in April 2021 — spinning counter-rotating 1.2 m carbon blades at ~2,500 rpm to grip air only ~1% as dense as Earth's! Planned for 5 flights, it completed 72 flights as Percy's aerial scout. Meanwhile, MOXIE heated Martian CO₂ air to ~800°C inside a solid-oxide electrolyzer and produced 122 grams of ~98% pure breathable oxygen — proving live-off-the-land propellant/life support!",
          tr: "Ingenuity, Nisan 2021'de başka bir gezegende ilk kontrollü motorlu uçuşu gerçekleştirdi; ~2.500 devir/dakika dönen pervaneleriyle incecik havada 5 uçuşluk planı 72 uçuşa çıkardı! MOXIE ise Mars'ın CO₂ havasını ~800°C'de elektroliz ederek %98 saflıkta 122 gram oksijen üretti.",
        },
      },
      {
        id: "mars_fact",
        label: { en: "Tell me a fact about Mars", tr: "Mars hakkında bir gerçek söyle" },
        question: {
          en: "Tell me a fact about Mars atmosphere, breathability, and water.",
          tr: "Mars atmosferi, solunabilirlik ve su hakkında bir gerçek söyle.",
        },
        answer: {
          en: "Mars's surface pressure (~6.1 mbar) sits right near the Armstrong limit where unprotected body moisture boils, and its 95.3% CO₂ mix contains only 0.16% O₂ — which is why spacesuits (plus ISRU oxygen generators like MOXIE) are essential! Billions of years ago, thicker air supported standing lakes like Gale and Jezero whose sediments remain our best archive of whether life ever emerged.",
          tr: "Mars yüzey basıncı (~6,1 mbar) Armstrong sınırına yakındır ve atmosferi %95,3 CO₂ içerip sadece %0,16 O₂ barındırır — bu nedenle basınçlı elbiseler ve MOXIE benzeri oksijen üreticileri zorunludur! Milyarlarca yıl önce daha kalın atmosfer sayesinde Gale ve Jezero gibi göller oluşmuştur.",
        },
      },
    ],
    knowledge: {
      overview:
        "Perseverance (Mars 2020, landed Feb 18, 2021 at Jezero Crater — 18.44°N, 77.45°E): 1,025 kg nuclear MMRTG astrobiology & sample-caching rover paired with the Ingenuity Mars Helicopter.",
      discoveries:
        "Explored Jezero's ancient river delta & lakebed mudstones, identified organic signatures and redox-banded 'Cheyava Falls' textures with SHERLOC/PIXL, cached sealed titanium core tubes (including Three Forks depot), and generated 122 g of O₂ via MOXIE.",
      powerAndControls:
        "Plutonium-238 MMRTG + reinforced 52.5 cm narrow-cleated aluminum wheels, AutoNav enhanced autonomous hazard driving, SuperCam laser/acoustic microphone, and helicopter radio base.",
      siteAndLongevity:
        "Active in Jezero Crater (>30 km driven); serves as our project's Concept B backup site if locked Gale stops ever fell outside HiRISE DTM coverage.",
    },
  },
]);

/**
 * Disabled / Placeholder NPC Roster for the Pink Zone (Corridor) Info Screens.
 * Kept modular and NOT spawned in the active scene until corridor screens are implemented.
 */
export const CORRIDOR_SCREEN_NPC_SPECS = Object.freeze([
  {
    id: "corridor_screen_npc_radiation",
    name: "Dr. Maya Brooks",
    shortName: "Dr. Brooks",
    tagText: "Dr. Brooks - RAD & DONKI Briefer",
    zone: "pink_corridor",
    screenSlot: "corridor_screen_01",
    enabled: false,
    accentHex: "#f472b6",
    role: {
      en: "Radiation & Space Weather Corridor Screen Specialist (Disabled Placeholder)",
      tr: "Radyasyon ve Uzay Havası Koridor Ekranı Uzmanı (Devre Dışı Yer Tutucu)",
    },
  },
  {
    id: "corridor_screen_npc_geology",
    name: "Dr. Tariq Al-Mansoor",
    shortName: "Dr. Tariq",
    tagText: "Dr. Tariq - HiRISE & Stratigraphy Briefer",
    zone: "pink_corridor",
    screenSlot: "corridor_screen_02",
    enabled: false,
    accentHex: "#ec4899",
    role: {
      en: "Orbital HiRISE & Stratigraphy Screen Specialist (Disabled Placeholder)",
      tr: "Yörünge HiRISE ve Stratigrafi Ekranı Uzmanı (Devre Dışı Yer Tutucu)",
    },
  },
  {
    id: "corridor_screen_npc_life_support",
    name: "Eng. Sofia Lindqvist",
    shortName: "Eng. Lindqvist",
    tagText: "Eng. Lindqvist - Habitat ECLSS Briefer",
    zone: "pink_corridor",
    screenSlot: "corridor_screen_03",
    enabled: false,
    accentHex: "#db2777",
    role: {
      en: "Habitat ECLSS & Crew Loop Screen Specialist (Disabled Placeholder)",
      tr: "Habitat Yaşam Destek Ekranı Uzmanı (Devre Dışı Yer Tutucu)",
    },
  },
]);

let customAiHook = null;

/**
 * Registers an optional external LLM / API responder `(context) => Promise<string | { answer }> | string | { answer }`.
 * Passing `null` restores pure offline rule/intent matching.
 */
export function registerNpcAiHook(handler) {
  customAiHook = typeof handler === "function" ? handler : null;
}

export function getNpcAiHook() {
  return customAiHook;
}

export function getNpcSpecById(npcId) {
  return MARS_STATION_NPCS.find((n) => n.id === npcId) || null;
}

export function getNpcByVehicleId(vehicleId) {
  const canonical = vehicleId === "nasa_concept" ? "mars_robo_concept" : vehicleId;
  return MARS_STATION_NPCS.find((n) => n.vehicleId === canonical) || null;
}

function normalizeQueryText(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERAL_MARS_TOPICS = {
  mars_atmosphere: {
    keywords: [
      "atmosphere",
      "atmosfer",
      "air",
      "hava",
      "breath",
      "breathe",
      "nefes",
      "solunum",
      "co2",
      "carbon dioxide",
      "karbondioksit",
      "pressure",
      "basinc",
      "mbar",
      "oxygen",
      "oksijen",
      "moxie",
      "wind",
      "ruzgar",
      "sound",
      "ses",
      "sky",
      "gokyuzu",
    ],
    en: "Mars's thin atmosphere averages ~6.1 mbar (~0.6% of Earth's sea-level pressure) and consists of ~95.3% CO₂, 2.6% N₂, 1.9% Ar, and only ~0.16% O₂. Sound travels slower (~240 m/s), unprotected water boils near the Armstrong limit, and astronauts must wear pressurized suits — though Perseverance's MOXIE experiment proved we can split CO₂ into breathable oxygen locally!",
    tr: "Mars atmosferi ortalama ~6,1 mbar basınçtadır (Dünya'nın %1'inden az) ve %95,3 CO₂, %2,6 N₂, %1,9 Ar içerir; oksijen oranı yalnızca %0,16'dır. Bu yüzden basınçlı elbise şarttır; ancak Perseverance üzerindeki MOXIE deneyi Mars havasındaki CO₂'den yerel olarak oksijen üretilebileceğini kanıtlamıştır.",
    sourceNote: "NASA Mars Fact Sheet & Mars 2020 MOXIE",
  },
  mars_gravity: {
    keywords: [
      "gravity",
      "yercekimi",
      "weigh",
      "weight",
      "agirlik",
      "jump",
      "zipla",
      "zip",
      "3.71",
      "3.717",
      "lope",
      "mass",
      "kutle",
      "bounce",
    ],
    en: "At Gale Crater, Mars gravity is ~3.717 m/s² (about 38% of Earth's 9.81 m/s², Lewis et al. 2019). Even carrying a heavy EVA suit, astronauts feel dramatically lighter — changing jumping arcs, metabolic pacing, and rover braking distance because wheel normal force is only 38% of Earth's.",
    tr: "Gale Krateri'nde Mars yerçekimi ~3,717 m/s²'dir (Dünya'nın yaklaşık %38'i, Lewis et al. 2019). Bu düşük yerçekimi ağır EVA elbiselerinde yürüyüşü ve zıplamayı hafifletirken, araç tekerleklerinin zemine basma kuvvetini de düşürdüğü için fren mesafesini uzatır.",
    sourceNote: "Lewis et al., Science 2019 (MSL Gravimetry)",
  },
  mars_water: {
    keywords: [
      "water",
      "su",
      "suyu",
      "suya",
      "suyun",
      "lake",
      "gol",
      "river",
      "nehir",
      "ocean",
      "okyanus",
      "ice",
      "buz",
      "wet",
      "mudstone",
      "camurtasi",
      "habitability",
      "yasanabilir",
      "life",
      "yasam",
      "organic",
      "organik",
      "biosignature",
      "biyoiz",
      "ancient",
      "antik",
    ],
    en: "Billions of years ago, Mars had liquid rivers, deltas, and long-lived lakes! Every flagship rover built the case: Sojourner saw flood rocks at Ares Vallis, Spirit found hydrothermal hot-spring silica at Gusev, Opportunity uncovered hematite concretions at Meridiani, Curiosity proved Gale Crater held a habitable freshwater lake with mudstone organic carbon, and Perseverance is caching delta cores in Jezero to search for ancient biosignatures. Today, water survives mainly as polar/subsurface ice and hydrated minerals.",
    tr: "Milyarlarca yıl önce Mars'ta akarsular, deltalar ve kalıcı göller vardı! Sojourner Ares Vallis'te taşkın kayaları, Spirit kaplıca silikaları, Opportunity hematit kürecikleri buldu; Curiosity Gale Krateri'nde yaşanabilir antik bir göl ve organik karbon tespit etti; Perseverance ise Jezero deltasında antik yaşam izleri arıyor. Günümüzde su çoğunlukla buz ve hidratlı mineraller halindedir.",
    sourceNote: "NASA MSL / MER / Pathfinder / Mars 2020 Archives",
  },
  mars_dust_weather: {
    keywords: [
      "dust",
      "toz",
      "storm",
      "firtina",
      "weather",
      "hava durumu",
      "climate",
      "iklim",
      "temperature",
      "sicaklik",
      "cold",
      "soguk",
      "hot",
      "sicak",
      "tau",
      "opacity",
      "rems",
      "devil",
      "seytan",
    ],
    en: "Martian weather swings fiercely! Curiosity's REMS station at Gale Crater regularly records daytime highs around −15°C to 0°C plunging to −75°C or −90°C before dawn. Fine iron-oxide dust colors the butterscotch sky, fuels localized dust devils that once cleaned Spirit's panels, and occasionally grows into global dust storms (optical depth tau > 10) like the 2018 event that ended Opportunity's mission.",
    tr: "Mars hava koşulları çok serttir! Gale Krateri'ndeki Curiosity REMS istasyonu gündüz −15°C ile 0°C arasından şafak öncesi −75°C/−90°C'ye düşen sıcaklıklar ölçer. İnce tozlar bazen toz şeytanları oluşturup Spirit'in panellerini temizlerken, 2018'deki gibi küresel toz fırtınaları (tau > 10) Opportunity'nin görevini sonlandırabilir.",
    sourceNote: "NASA MSL REMS & MER Archives",
  },
  mars_radiation: {
    keywords: [
      "radiation",
      "radyasyon",
      "rad",
      "msv",
      "dose",
      "doz",
      "cosmic",
      "kozmik",
      "solar flare",
      "gunes patlamasi",
      "cme",
      "donki",
      "shield",
      "kalkan",
      "cancer",
      "safe",
    ],
    en: "Curiosity's RAD instrument measured a surface galactic cosmic-ray baseline of ~0.64 ± 0.12 mSv/day at Gale Crater (~−4.4 km MOLA, Hassler et al. 2014). Unlike terrestrial minefields, radiation on a ~10 km EVA hardly varies from rock to rock — it's a TIME and SHIELDING budget problem plus transient solar particle events tracked by NASA DONKI WSA-Enlil forecasts.",
    tr: "Curiosity RAD cihazı Gale Krateri'nde (~−4,4 km MOLA) günlük ~0,64 ± 0,12 mSv galaktik kozmik ışın dozu ölçmüştür (Hassler et al. 2014). ~10 km'lik bir yürüyüşte radyasyon kayadan kayağa değişmez — esas olarak açık arazide geçirilen SÜRE, koruma ve NASA DONKI ile izlenen güneş parçacık olaylarıyla ilgilidir.",
    sourceNote: "Hassler et al., Science 2014 & NASA CCMC DONKI",
  },
  mars_moons_terrain: {
    keywords: [
      "phobos",
      "deimos",
      "moon",
      "uydu",
      "ay",
      "slope",
      "egim",
      "steep",
      "dik",
      "hirise",
      "dtm",
      "boxwork",
      "kafes",
      "altadena",
      "mount sharp",
      "gale",
      "o2",
      "walking time",
      "placeholder",
    ],
    en: "Above Gale Crater, tiny potato-shaped moon Phobos actually rises in the west and zips eastward across the sky roughly every 11 hours, while Deimos creeps west. Down on Mount Sharp, our 1 m HiRISE DTMs (DTEEC_019698) guide route planning around the Altadena boxwork unit — though we honestly flag that 15°–20° slope thresholds are lunar ConOps stand-ins, orbital DTM slopes match rover tilt only weakly (~9.0° vs 8.6°), and EVA walk time / O₂ metrics are illustrative placeholders.",
    tr: "Gale Krateri semalarında Phobos uydusu batıdan doğup doğuya doğru ~11 saatte bir tur atarken, Deimos doğudan yükselir. Mount Sharp zemininde ise HiRISE 1 m DTM (DTEEC_019698) kullanıyoruz; ancak dürüstçe belirtelim ki 15°–20° eğim sınırları Ay ConOps uyarlamasıdır, DTM-gezgin eğim eşleşmesi zayıftır (~9.0° vs 8.6°) ve yürüme süresi / O₂ değerleri açıklayıcı yer tutuculardır.",
    sourceNote: "HiRISE DTEEC_019698, NASA Exploration EVA ConOps, JPL Horizons",
  },
};

const VEHICLE_TOPIC_KEYWORDS = {
  overview: [
    "overview",
    "capability",
    "capabilities",
    "spec",
    "specs",
    "mass",
    "weight",
    "heavy",
    "size",
    "big",
    "tall",
    "dimension",
    "build",
    "design",
    "engineer",
    "yetene",
    "ozellik",
    "agirlik",
    "boyut",
  ],
  discoveries: [
    "discover",
    "discovery",
    "found",
    "find",
    "science",
    "experiment",
    "instrument",
    "mineral",
    "hematite",
    "blueberries",
    "blueberry",
    "silica",
    "mudstone",
    "boxwork",
    "organic",
    "sample",
    "cache",
    "tube",
    "cheyava",
    "delta",
    "barnacle",
    "yogi",
    "yellowknife",
    "kesif",
    "kesfet",
    "buldu",
    "bilim",
    "mineral",
    "numune",
  ],
  powerAndControls: [
    "power",
    "battery",
    "batteries",
    "solar",
    "panel",
    "rtg",
    "mmrtg",
    "nuclear",
    "plutonium",
    "energy",
    "wheel",
    "wheels",
    "tire",
    "tires",
    "suspension",
    "rocker",
    "bogie",
    "nitinol",
    "drive",
    "driving",
    "control",
    "controls",
    "steer",
    "speed",
    "fast",
    "drift",
    "guc",
    "pil",
    "batarya",
    "gunes",
    "nukleer",
    "tekerlek",
    "suspansiyon",
    "sur",
    "kontrol",
    "hiz",
  ],
  siteAndLongevity: [
    "where",
    "site",
    "landing",
    "crater",
    "gale",
    "mount sharp",
    "aeolis",
    "jezero",
    "gusev",
    "meridiani",
    "ares vallis",
    "columbia",
    "endeavour",
    "eagle",
    "sol",
    "sols",
    "long",
    "year",
    "years",
    "distance",
    "km",
    "far",
    "how long",
    "nerede",
    "krater",
    "inis",
    "kac yil",
    "mesafe",
    "uzun",
  ],
};

const VEHICLE_SYNONYMS = {
  mmsev: ["mmsev", "active rover", "pressurized", "basinc", "current rover"],
  mars_robo_concept: ["robo concept", "concept", "futuristic", "nitinol", "autonomous concept", "konsept"],
  sojourner: ["sojourner", "pathfinder", "1997", "ares vallis", "microwave", "barnacle"],
  spirit: ["spirit", "mer a", "mer-a", "gusev", "home plate", "silica", "columbia hills"],
  opportunity: ["opportunity", "oppy", "mer b", "mer-b", "meridiani", "blueberries", "hematite", "5111", "45"],
  curiosity: ["curiosity", "msl", "bradbury", "rad", "rems", "sam", "chemin", "altadena", "yellowknife"],
  perseverance: ["perseverance", "percy", "mars 2020", "jezero", "ingenuity", "helicopter", "helikopter", "moxie", "sherloc", "pixl"],
};

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "and",
  "or",
  "do",
  "did",
  "does",
  "how",
  "what",
  "tell",
  "me",
  "about",
  "its",
  "it",
  "i",
  "like",
  "ne",
  "kadar",
  "nedir",
  "mi",
  "mu",
]);

function createKnowledgeIndices() {
  const processTerm = (term) => {
    const t = normalizeQueryText(term);
    if (!t || STOP_WORDS.has(t)) return null;
    return t;
  };

  const marsIndex = new MiniSearch({
    fields: ["keywords"],
    storeFields: ["id", "topicKey"],
    processTerm,
    searchOptions: {
      boost: { keywords: 4 },
      fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
      prefix: (term) => term.length >= 5,
    },
  });
  for (const [topicKey, entry] of Object.entries(GENERAL_MARS_TOPICS)) {
    marsIndex.add({
      id: `mars:${topicKey}`,
      topicKey,
      keywords: entry.keywords.join(" "),
    });
  }

  const vehicleTopicIndex = new MiniSearch({
    fields: ["keywords"],
    storeFields: ["id", "topicKey"],
    processTerm,
    searchOptions: {
      boost: { keywords: 3 },
      fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
      prefix: (term) => term.length >= 5,
    },
  });
  for (const [topicKey, kws] of Object.entries(VEHICLE_TOPIC_KEYWORDS)) {
    vehicleTopicIndex.add({
      id: `vtopic:${topicKey}`,
      topicKey,
      keywords: kws.join(" "),
    });
  }

  const crossRoverIndex = new MiniSearch({
    fields: ["synonyms"],
    storeFields: ["id", "vehicleId"],
    processTerm: (term) => {
      const t = processTerm(term);
      if (!t || t === "mars" || t === "rover" || t === "active" || t === "current") return null;
      return t;
    },
    searchOptions: {
      boost: { synonyms: 3 },
      fuzzy: (term) => (term.length >= 6 ? 0.2 : false),
      prefix: (term) => term.length >= 5,
    },
  });
  for (const [vehicleId, words] of Object.entries(VEHICLE_SYNONYMS)) {
    crossRoverIndex.add({
      id: `veh:${vehicleId}`,
      vehicleId,
      synonyms: words.join(" "),
    });
  }

  const intentIndex = new MiniSearch({
    fields: ["keywords"],
    storeFields: ["id", "intent"],
    processTerm,
    searchOptions: {
      boost: { keywords: 3 },
      fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
      prefix: (term) => term.length >= 4,
    },
  });
  intentIndex.addAll([
    {
      id: "intent:identity",
      intent: "identity",
      keywords: "who are you your name hello hi hey greetings kimsin adin merhaba selam",
    },
    {
      id: "intent:ingenuity_moxie",
      intent: "ingenuity_moxie",
      keywords: "helicopter ingenuity fly flight rotor drone helikopter ucus moxie",
    },
  ]);

  return { marsIndex, vehicleTopicIndex, crossRoverIndex, intentIndex };
}

const { marsIndex, vehicleTopicIndex, crossRoverIndex, intentIndex } = createKnowledgeIndices();

function detectCrossRoverMention(normQ, ownVehicleId) {
  const hits = crossRoverIndex.search(normQ);
  if (hits.length > 0 && hits[0].vehicleId !== ownVehicleId && hits[0].score >= 1.5) {
    return hits[0].vehicleId;
  }
  return null;
}

/**
 * Deterministic, 100% offline BM25/TF-IDF + fuzzy Q&A resolver powered by `minisearch`.
 * Guarantees accurate in-character answers about the assigned rover AND general Mars science.
 */
export function answerNpcQuestion(npcId, rawQuestion, { lang = "en" } = {}) {
  const npc = getNpcSpecById(npcId) || MARS_STATION_NPCS[0];
  const isTr = lang === "tr";
  const q = String(rawQuestion || "").trim();
  const normQ = normalizeQueryText(q);

  const mkResult = (answer, topic, sourceNote = "NASA Mission Archives & Project Constraints") => ({
    answer,
    topic,
    npcId: npc.id,
    npcName: npc.name,
    vehicleId: npc.vehicleId,
    sourceNote,
  });

  if (!normQ) {
    return mkResult(isTr ? npc.greeting.tr : npc.greeting.en, "greeting");
  }

  // 1. Exact / near match to one of this NPC's preset questions
  for (const preset of npc.presets) {
    const pNormEn = normalizeQueryText(preset.question.en);
    const pNormTr = normalizeQueryText(preset.question.tr);
    const lNormEn = normalizeQueryText(preset.label.en);
    const lNormTr = normalizeQueryText(preset.label.tr);
    if (normQ === pNormEn || normQ === pNormTr || normQ === lNormEn || normQ === lNormTr) {
      return mkResult(isTr ? preset.answer.tr : preset.answer.en, `preset:${preset.id}`);
    }
  }

  const intentHits = intentIndex.search(normQ);

  // 2. Identity / greeting intents
  const idHit = intentHits.find((h) => h.intent === "identity");
  if (idHit && idHit.score >= 1.2 && normQ.split(" ").length <= 7) {
    const roleStr = isTr ? npc.role.tr : npc.role.en;
    const vehStr = isTr ? npc.vehicleName.tr : npc.vehicleName.en;
    return mkResult(
      isTr
        ? `Ben ${npc.name} (${roleStr}). Görevim buradaki ${vehStr} aracını denetlemek ve Mars bilimi sorularını yanıtlamak.`
        : `I'm ${npc.name}, your ${roleStr}. My station is assigned to ${vehStr} — ask me anything about its engineering, discoveries, or Mars science!`,
      "identity"
    );
  }

  // 3. Special Ingenuity / Helicopter / MOXIE check (always route accurately, tying back to Perseverance if needed)
  const heloHit = intentHits.find((h) => h.intent === "ingenuity_moxie");
  if (heloHit && heloHit.score >= 1.5) {
    const percy = getNpcByVehicleId("perseverance");
    const ans =
      percy?.presets.find((p) => p.id === "rover_ingenuity_moxie")?.answer[isTr ? "tr" : "en"] ||
      percy?.knowledge.discoveries;
    const prefix =
      npc.vehicleId === "perseverance"
        ? ""
        : isTr
          ? `Bu konuda Dr. Elena Vega (Perseverance) uzman olsa da paylaşayım: `
          : `Dr. Elena Vega over at Perseverance leads that specialty, though here's the summary: `;
    return mkResult(prefix + ans, "ingenuity_moxie", "NASA/JPL Mars 2020 Ingenuity & MOXIE");
  }

  // 4. Score General Mars Science topics vs Vehicle-specific topics via MiniSearch BM25
  const marsHits = marsIndex.search(normQ);
  const bestMarsTopic = marsHits[0]?.topicKey || null;
  const bestMarsScore = marsHits[0]?.score || 0;

  const vehicleHits = vehicleTopicIndex.search(normQ);
  const bestVehicleTopic = vehicleHits[0]?.topicKey || null;
  const bestVehicleScore = vehicleHits[0]?.score || 0;

  // Cross-rover query? (e.g., asking Cmdr. Rivera about Opportunity)
  const otherVehId = detectCrossRoverMention(normQ, npc.vehicleId);
  if (otherVehId) {
    const peerNpc = getNpcByVehicleId(otherVehId);
    if (peerNpc) {
      const targetPreset =
        bestVehicleTopic === "discoveries"
          ? peerNpc.presets.find((p) => p.id === "rover_discovery") || peerNpc.presets[0]
          : peerNpc.presets[0];
      const peerText = targetPreset.answer[isTr ? "tr" : "en"];
      const handoff = isTr
        ? `Ben burada ${npc.vehicleName.tr} uzmanıyım, ama meslektaşım ${peerNpc.shortName} (${peerNpc.vehicleName.tr}) adına özetleyeyim:\n\n${peerText}\n\nDaha derin detaylar için baydaki ${peerNpc.shortName} ile de konuşabilirsin!`
        : `My direct assignment here is ${npc.vehicleName.en}, though I collaborate closely with ${peerNpc.shortName} over at ${peerNpc.vehicleName.en}:\n\n${peerText}\n\nFeel free to walk over and speak with ${peerNpc.shortName} too!`;
      return mkResult(handoff, `cross_rover:${otherVehId}`);
    }
  }

  const asksOwnVehicle = normQ.includes("this") || normQ.includes("your") || normQ.includes("bu ") || normQ.includes("senin");
  if (bestMarsTopic && bestMarsScore >= 1.5 && (!asksOwnVehicle || bestMarsScore > bestVehicleScore + 0.5) && bestMarsScore >= bestVehicleScore) {
    const topicObj = GENERAL_MARS_TOPICS[bestMarsTopic];
    const responseText = topicObj[isTr ? "tr" : "en"];
    return mkResult(responseText, bestMarsTopic, topicObj.sourceNote || "NASA Mars Data");
  }

  // Vehicle-specific preset / deep knowledge match
  if (bestVehicleTopic && bestVehicleScore >= 1.0) {
    if (bestVehicleTopic === "discoveries") {
      const p = npc.presets.find((x) => x.id === "rover_discovery");
      return mkResult((p ? p.answer[isTr ? "tr" : "en"] : null) || npc.knowledge.discoveries, "vehicle_discoveries");
    }
    if (bestVehicleTopic === "powerAndControls") {
      const wantsWheels = ["wheel", "wheels", "tire", "tires", "suspension", "nitinol", "bogie", "rocker", "tekerlek", "suspansiyon"].some(
        (w) => normQ.includes(w)
      );
      const p =
        (wantsWheels ? npc.presets.find((x) => x.id === "rover_wheels") : null) ||
        npc.presets.find(
          (x) => x.id === "rover_controls" || x.id === "rover_power" || x.id === "rover_wheels" || x.id === "rover_longevity"
        );
      if (isTr && p) return mkResult(p.answer.tr, "vehicle_power_controls");
      if (wantsWheels && p?.answer?.en) return mkResult(p.answer.en, "vehicle_power_controls");
      if (p?.answer?.en && npc.knowledge.powerAndControls && !p.answer.en.includes(npc.knowledge.powerAndControls.slice(0, 24))) {
        return mkResult(`${p.answer.en}\n\n${npc.knowledge.powerAndControls}`, "vehicle_power_controls");
      }
      return mkResult(npc.knowledge.powerAndControls || p?.answer?.en, "vehicle_power_controls");
    }
    if (bestVehicleTopic === "siteAndLongevity") {
      const p = npc.presets.find((x) => x.id === "rover_longevity" || x.id === "rover_storm" || x.id === "rover_rad_rems") || npc.presets[0];
      if (isTr && p) return mkResult(p.answer.tr, "vehicle_site_longevity");
      const baseEn = p?.answer?.en || npc.presets[0]?.answer?.en || "";
      if (baseEn && npc.knowledge.siteAndLongevity && !baseEn.includes(npc.knowledge.siteAndLongevity.slice(0, 24))) {
        return mkResult(`${baseEn}\n\n${npc.knowledge.siteAndLongevity}`, "vehicle_site_longevity");
      }
      return mkResult(npc.knowledge.siteAndLongevity || baseEn, "vehicle_site_longevity");
    }
    const pOverview = npc.presets[0];
    return mkResult(isTr ? pOverview.answer.tr : `${pOverview.answer.en}\n\n${npc.knowledge.siteAndLongevity}`, "vehicle_overview");
  }

  if (bestMarsTopic && bestMarsScore > 0) {
    const topicObj = GENERAL_MARS_TOPICS[bestMarsTopic];
    return mkResult(topicObj[isTr ? "tr" : "en"], bestMarsTopic, topicObj.sourceNote || "NASA Mars Data");
  }

  // General "mars" mention fallback
  if (normQ.includes("mars")) {
    const marsPreset = npc.presets.find((p) => p.id === "mars_fact") || npc.presets[0];
    return mkResult(isTr ? marsPreset.answer.tr : marsPreset.answer.en, "mars_general");
  }

  // Thoughtful in-character fallback steering user cleanly to vehicle + Mars topics
  const overview = npc.presets[0].answer[isTr ? "tr" : "en"];
  const fallback = isTr
    ? `Güzel soru! ${npc.vehicleName.tr} açısından yaklaşayım: ${overview}\n\nİstersen Mars atmosferi, yerçekimi, su/yaşanabilirlik, toz fırtınaları, radyasyon veya bu aracın güç ve keşifleri hakkında da sorabilirsin.`
    : `Great question! From my station here at ${npc.vehicleName.en}: ${overview}\n\nYou can also ask me specifically about Mars atmosphere, gravity, ancient water, dust storms, radiation dose budgets (RAD/DONKI), wheels/power, or any other rover in the bay!`;
  return mkResult(fallback, "fallback_overview");
}

/**
 * Modular hook wrapper: invokes registered external LLM/API handler if present,
 * otherwise runs pure offline `answerNpcQuestion`.
 */
export async function queryNpcWithHook(npcId, rawQuestion, options = {}) {
  const npc = getNpcSpecById(npcId) || MARS_STATION_NPCS[0];
  if (customAiHook) {
    try {
      const hooked = await customAiHook({
        npc,
        question: rawQuestion,
        lang: options.lang || "en",
      });
      if (typeof hooked === "string" && hooked.trim()) {
        return {
          answer: hooked.trim(),
          topic: "external_llm",
          npcId: npc.id,
          npcName: npc.name,
          vehicleId: npc.vehicleId,
          sourceNote: "Custom AI Hook",
        };
      }
      if (hooked && typeof hooked.answer === "string" && hooked.answer.trim()) {
        return {
          ...hooked,
          npcId: npc.id,
          npcName: npc.name,
          vehicleId: npc.vehicleId,
        };
      }
    } catch (err) {
      console.warn("NPC external AI hook failed, falling back to offline engine:", err);
    }
  }
  return answerNpcQuestion(npcId, rawQuestion, options);
}
