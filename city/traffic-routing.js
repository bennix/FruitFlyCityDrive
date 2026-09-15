// Search alternate legal exits when a queue's chosen turn remains blocked.
// Check the turn itself as well as enough downstream space to clear the junction.
export function findTrafficExit(lane, outgoing, clear, random = Math.random, penalty = () => 0) {
  let budget = 64;
  function visit(previous, path, distance) {
    if (distance >= 5.5) return path;
    if (path.length >= 12 || --budget < 0) return null;
    const legal = outgoing[previous.to].filter(next => next.buildingClear);
    const forward = legal.filter(next => next.to !== previous.from);
    const choices = forward.length ? forward : legal;
    const offset = Math.floor(random() * choices.length);
    const ranked=choices.map((_,i)=>choices[(offset+i)%choices.length])
      .sort((a,b)=>penalty(a)-penalty(b));
    for (const next of ranked) {
      if (path.includes(next) || !clear(previous, next, Math.min(next.length, 5.5-distance))) continue;
      const result = visit(next, [...path, next], distance+next.length);
      if (result) return result;
    }
    return null;
  }
  return visit(lane, [], 0);
}

export function canClaimJunction(entering, exitClear, red, progress, stopAt) {
  // Reaching the line is not entering: division/multiplication can round upward.
  return entering && exitClear && !red && progress > stopAt + .001;
}

// Release the intersection once the whole car has left its conflict area.
// A downstream queue must not keep an already cleared intersection locked.
export function clearedJunction(junction,nodes,position,heading) {
  if(!junction)return false;
  return junction.members.every(id=>{
    const node=nodes[id],dx=position.x-node.x,dz=position.z-node.z;
    return Math.hypot(dx,dz)>4.5 && dx*Math.sin(heading)+dz*Math.cos(heading)>0;
  });
}

export function downstreamBlocked(lane,requiredDistance,red,occupied) {
  return !!lane.controlled && requiredDistance>lane.stopAt+.001 && (red||occupied);
}
