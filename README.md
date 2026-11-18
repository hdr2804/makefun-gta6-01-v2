# SOLMAR: Sunset Getaway

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/hdr2804/makefun-gta6-01-v2/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/hdr2804/makefun-gta6-01-v2/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An open-world crime game in the spirit of GTA 6, built for the make.fun
**gta6-01 "Make GTA 6"** competition. Solmar is a sun-soaked coastal city at
golden hour. You are a getaway driver for hire, fresh out of the game, taking
jobs from fixer **Marisol Vega**: pickups, timed deliveries, tail jobs, a
marina heist, a run through a police blockade, and one final five-star
**Sunset Run** to the boat.

## What is in the game

- **A city to explore on foot and by car** — 9×9 blocks of towers, shops,
  palms, a beach and a marina, with traffic, pedestrians, a safehouse garage
  and destructible props.
- **Cars to steal and drive** — enter any parked or traffic car (stealing one
  in front of the police raises your wanted level), with arcade handling,
  handbrake slides, skid marks and stunt ramps.
- **Wanted 0–5 stars** — patrol cars cruise until you make trouble; then they
  pursue, ram and set roadblocks, and a helicopter with a spotlight joins at
  4–5 stars. Break line of sight and distance to cool down, or pay the heat
  off at the safehouse.
- **Six chained missions with a story**, briefing cards, objective markers,
  a 3D beacon, HUD arrow and minimap blips, payouts and time bonuses.
- **Things to do between jobs** — taxi fares, a street race, stunt ramps,
  sunset tokens, random city events (armored trucks, festivals, checkpoints),
  a garage to keep stolen cars in, and car upgrades (engine, armor, tires).
- **HUD with a live minimap** (player, police, traffic, mission marker,
  safehouse, marina), speed, cash, health, car health, wanted stars and a
  mission objective line. Start screen, pause menu with shop, results
  screens for wins and busts, and a save in localStorage.
- **Procedural sound** — engine hum, sirens, impacts and three switchable
  radio stations, all synthesized live with WebAudio. No audio files.
- **Original everything** — Solmar, Marisol Vega and every car, street and
  face in the game are invented here. No Rockstar names, characters, map, art
  or music.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Drive / walk |
| E | Enter or steal a car · exit a car when stopped |
| Space | Handbrake |
| Shift | Sprint on foot |
| M | Take the next job / re-read the briefing |
| P / Esc | Pause · garage & upgrades |
| H | Pay off heat at the safehouse (on foot, costs cash) |
| T | Start a street race (in a car, off-mission) |
| J / click | Punch (on foot) |
| Q | Switch radio station · N mute |

## How to run

```sh
node serve.ts
# then open http://localhost:8080
```

Static files only — `game/index.html` plus its modules, three.js r170
vendored under `game/vendor/`. No build step, no network at runtime.

`main.ts` hands the game in: it copies `game/` and `screenshots/` to
`/output` and writes `/output/dossier.json` with the vendored make.fun
library. Check it locally with:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Layout

- `game/index.html` — page, HUD, menus
- `game/css/style.css` — interface styling
- `game/js/main.js` — boot, render loop, camera, states, `?shot=` scenes
- `game/js/city.js` — seeded Solmar: roads, buildings, palms, beach, marina
- `game/js/vehicles.js` — car meshes, driving physics, traffic AI
- `game/js/pedestrians.js` — sidewalk walkers, panic, knock-downs
- `game/js/police.js` — patrol, pursuit, roadblocks, helicopter, wanted decay
- `game/js/missions.js` — the six jobs for Marisol Vega
- `game/js/player.js` — on foot and behind the wheel, stealing, busted/wrecked
- `game/js/hud.js` — HUD, minimap, briefing and results cards
- `game/js/audio.js` — procedural WebAudio: engine, sirens, radio
- `game/js/save.js` — progression, garage, upgrades
- `game/js/effects.js` — particles, skid marks, dust, screen shake, popups
- `game/js/activities.js` — fares, stunt ramps, street race, sunset tokens
- `game/js/combat.js` — on-foot punches and police retaliation
- `game/js/world-events.js` — random city events between jobs
- `game/vendor/three.module.min.js` — three.js r170 (vendored library)
- `screenshots/` — four real renders of the game (title, chase, on foot, results)

## License

MIT — see `LICENSE`.
