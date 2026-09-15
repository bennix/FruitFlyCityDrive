// Navigation supplies a legal lane; neural output supplies speed and a bounded
// steering correction. All proposed movement still passes the collision shield.
export function cooperativeTarget(a,b,t,neuralTurn=0,laneOffset=.7) {
  const roadHeading=Math.atan2(b.x-a.x,b.z-a.z);
  const correction=Math.max(-1,Math.min(1,neuralTurn))*.04;
  const offset=laneOffset+correction;
  return {x:a.x+(b.x-a.x)*t+Math.cos(roadHeading)*offset,
    y:a.y+(b.y-a.y)*t+.3,z:a.z+(b.z-a.z)*t-Math.sin(roadHeading)*offset,
    pitch:-Math.atan2(b.y-a.y,Math.hypot(b.x-a.x,b.z-a.z)),heading:roadHeading+correction};
}
