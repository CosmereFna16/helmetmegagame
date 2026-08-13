function PixelTree({ x, y }) {
  return (
    <g fill="currentColor">
      <rect x={x + 7} y={y - 10} width={6} height={10} />
      <rect x={x} y={y - 20} width={20} height={10} />
      <rect x={x + 3} y={y - 28} width={14} height={8} />
      <rect x={x + 6} y={y - 34} width={8} height={6} />
    </g>
  );
}

function Shrub({ x, y }) {
  return (
    <g fill="currentColor">
      <rect x={x} y={y - 6} width={8} height={6} />
      <rect x={x + 6} y={y - 9} width={8} height={9} />
      <rect x={x + 13} y={y - 5} width={7} height={5} />
    </g>
  );
}

export default function PixelScenery() {
  return (
    <svg
      className="pixel-scenery"
      viewBox="0 0 400 100"
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M0,100 L0,30 L10,30 L10,50 L20,50 L20,70 L30,70 L30,90 L40,90 L40,60 L50,60 L50,80 L60,80 L60,50 L70,50 L70,70 L80,70 L80,40 L90,40 L90,100 Z"
      />
      <path
        fill="currentColor"
        d="M400,100 L400,35 L390,35 L390,55 L380,55 L380,75 L370,75 L370,45 L360,45 L360,65 L350,65 L350,85 L340,85 L340,55 L330,55 L330,100 Z"
      />

      <PixelTree x={110} y={100} />
      <PixelTree x={150} y={98} />
      <PixelTree x={230} y={99} />
      <PixelTree x={270} y={97} />
      <PixelTree x={310} y={100} />

      <Shrub x={100} y={100} />
      <Shrub x={190} y={99} />
      <Shrub x={250} y={100} />
      <Shrub x={300} y={98} />
    </svg>
  );
}
