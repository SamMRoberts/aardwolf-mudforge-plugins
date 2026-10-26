// Synthetic browser host only. These replies do not execute the Lua adapter or
// query MudForge's mapper, route finder, storage, or window manager.
export async function installAtlasBridge(page) {
  await page.addInitScript(() => {
    const rooms = [
      { id: 1, areaId: 'smoke', name: 'Smoke crossing', x: 0, y: 0, z: 0,
        terrain: 'forest', exits: { e: 2 } },
      { id: 2, areaId: 'smoke', name: 'Smoke destination', x: 1, y: 0, z: 0,
        terrain: 'stone', exits: { w: 1 }, notes: 'Synthetic route destination.' },
      { id: 3, areaId: 'archive', name: 'Smoke archive', x: 0, y: 1, z: 0,
        terrain: 'inside', exits: {} },
    ];
    const preferences = { view: 'overhead', follow: true, exploded: false,
      collapsed: false, showVnums: true, northUp: false, floatingDetails: false };
    const snapshot = { v: 1, revision: 1, mapReady: true,
      areas: [{ id: 'smoke', name: 'Smoke area' }, { id: 'archive', name: 'Smoke archive' }],
      playerRoomId: 1, playerAreaId: 'smoke', playerZ: 0 };
    const receive = (data) => queueMicrotask(() => window.smoke.receive({ v: 1, revision: 1, ...data }));
    window.addEventListener('smoke-send', ({ detail: { event, data } }) => {
      if (event !== 'atlas') return;
      if (data.action === 'ready') receive({ ...snapshot, type: 'init', preferences });
      else if (data.action === 'preferences') {
        Object.assign(preferences, data.patch);
        receive({ type: 'preferences', preferences: { ...preferences } });
      } else if (data.action === 'area') {
        const source = rooms.filter(room => room.areaId === data.areaId);
        receive({ type: 'area', areaId: data.areaId, generation: data.generation,
          offset: data.offset, rooms: source.slice(data.offset), nextOffset: source.length,
          total: source.length, done: true });
      } else if (data.action === 'inspect') {
        receive({ type: 'room', generation: data.generation,
          room: rooms.find(room => room.id === data.roomId) });
      } else if (data.action === 'route') {
        const destination = rooms.find(room => room.id === data.roomId);
        receive({ type: 'route', generation: data.generation, found: Boolean(destination),
          stepCount: 1, cost: 1, steps: destination ? [{ roomId: destination.id,
            areaId: destination.areaId, z: destination.z, name: destination.name, direction: 'east' }] : [] });
      }
    });
    window.atlasSmokeUpdate = () => receive({ ...snapshot, type: 'update', playerRoomId: 2 });
  });
}

export async function retainAtlasDrawingBuffer(page) {
  await page.addInitScript(() => {
    // Chromium normally discards the drawing buffer after composition. Retain
    // it in this fixture so readPixels can prove the real renderer drew tiles.
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attributes) {
      return getContext.call(this, type,
        type === 'webgl2' ? { ...attributes, preserveDrawingBuffer: true } : attributes);
    };
  });
}
