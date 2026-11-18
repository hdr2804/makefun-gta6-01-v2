// input.js — keyboard + mouse, in one place.
// WASD / arrows drive, Shift sprints, Space handbrakes, E enters/exits
// cars, Q switches radio station, R toggles radio, M mutes, Esc pauses,
// P opens the phone, F toggles fullscreen. The game also reads keys
// through this module so the playtest can inject synthetic input.
export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered, consumed by update()
    this.mouseDown = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheelDelta = 0;
    this.onKeyDown = null; // hook: main.js resumes audio on first gesture
    this.onAnyInput = null;
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (this.onKeyDown) this.onKeyDown(e.code);
      if (this.onAnyInput) this.onAnyInput();
      // Keep the page from scrolling on game keys.
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouseDown = false; });
    window.addEventListener('mousedown', (e) => {
      if (e.target && (e.target.tagName === 'BUTTON' || e.target.closest('button'))) return;
      this.mouseDown = true;
      if (this.onAnyInput) this.onAnyInput();
    });
    window.addEventListener('mouseup', () => { this.mouseDown = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.mouseDown) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });
    window.addEventListener('wheel', (e) => { this.wheelDelta += e.deltaY; }, { passive: true });
    // Touch: left half = move stick, right half = drag camera. Kept small;
    // the bounty is a desktop keyboard-and-mouse game.
    this.touch = { active: false, x0: 0, y0: 0, x: 0, y: 0 };
    window.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      this.touch.active = true; this.touch.x0 = t.clientX; this.touch.y0 = t.clientY;
      this.touch.x = t.clientX; this.touch.y = t.clientY;
      if (this.onAnyInput) this.onAnyInput();
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      this.touch.x = t.clientX; this.touch.y = t.clientY;
    }, { passive: true });
    window.addEventListener('touchend', () => { this.touch.active = false; }, { passive: true });
  }

  down(code) { return this.keys.has(code); }

  // Edge-triggered: true only on the frame the key went down.
  wasPressed(code) { return this.pressed.has(code); }

  consumeMouse() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  }

  consumeWheel() {
    const d = this.wheelDelta;
    this.wheelDelta = 0;
    return d;
  }

  // Driving input, -1..1 throttle/steer, from keys (and the touch stick).
  driveInput() {
    let throttle = 0, steer = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) throttle += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) throttle -= 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) steer -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) steer += 1;
    if (this.touch.active) {
      const dx = this.touch.x - this.touch.x0;
      const dy = this.touch.y - this.touch.y0;
      steer += Math.max(-1, Math.min(1, dx / 60));
      throttle += Math.max(-1, Math.min(1, -dy / 60));
    }
    return {
      throttle: Math.max(-1, Math.min(1, throttle)),
      steer: Math.max(-1, Math.min(1, steer)),
      handbrake: this.down('Space'),
    };
  }

  // On-foot movement input.
  walkInput() {
    return {
      forward: this.down('KeyW') || this.down('ArrowUp'),
      back: this.down('KeyS') || this.down('ArrowDown'),
      left: this.down('KeyA') || this.down('ArrowLeft'),
      right: this.down('KeyD') || this.down('ArrowRight'),
      sprint: this.down('ShiftLeft') || this.down('ShiftRight'),
    };
  }

  // Called at the end of each frame: clears edge triggers.
  endFrame() {
    this.pressed.clear();
  }

  // Test hook: pretend a key is held / pressed (used by the playtest).
  testDown(code) { this.keys.add(code); }
  testUp(code) { this.keys.delete(code); }
  testPress(code) { this.keys.add(code); this.pressed.add(code); }
}
