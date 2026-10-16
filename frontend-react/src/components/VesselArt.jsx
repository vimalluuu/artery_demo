// Decorative schematic, deliberately separate from medical image viewers.
export default function VesselArt({ caption = true }) {
  return (
    <div className="hero-art" aria-hidden="true">
      <svg viewBox="0 0 420 340" fill="none">
        <g stroke="#626d56" strokeWidth=".5" opacity=".22">
          {[70, 120, 170, 220, 270].map((y) => (
            <path key={y} d={`M20 ${y}H400`} />
          ))}
          {[60, 120, 180, 240, 300, 360].map((x) => (
            <path key={x} d={`M${x} 20V320`} />
          ))}
        </g>
        <ellipse
          cx="217"
          cy="180"
          rx="116"
          ry="132"
          stroke="#5a6550"
          strokeDasharray="3 7"
          opacity=".55"
        />
        <ellipse
          cx="217"
          cy="180"
          rx="89"
          ry="103"
          stroke="#5a6550"
          opacity=".3"
        />
        <g
          stroke="#79886a"
          strokeWidth="16"
          opacity=".13"
          strokeLinecap="round"
        >
          <path d="M215 24C217 73 177 96 195 136S256 181 246 229S216 280 225 319" />
          <path d="M198 140C152 130 117 155 107 203S95 267 65 283M227 179C279 151 291 104 330 98M245 232C285 242 300 270 338 289" />
        </g>
        <g stroke="#b8c8a7" strokeWidth="3.5" strokeLinecap="round">
          <path d="M215 24C217 73 177 96 195 136S256 181 246 229S216 280 225 319" />
          <path d="M198 140C152 130 117 155 107 203S95 267 65 283M227 179C279 151 291 104 330 98M245 232C285 242 300 270 338 289" />
        </g>
        <g stroke="#a4b694" strokeWidth="1.7" strokeLinecap="round">
          <path d="M106 206C134 210 151 235 154 265M120 164C96 151 77 153 57 142M277 141C307 149 333 148 357 166M292 118C274 98 279 68 272 46M306 271C327 254 345 252 369 254M234 278C201 284 175 300 163 324M201 86C167 73 146 81 130 64M184 115C160 103 146 108 129 99" />
        </g>
        <g fill="#d4dec9">
          <circle cx="198" cy="140" r="5" />
          <circle cx="227" cy="179" r="5" />
          <circle cx="245" cy="232" r="5" />
        </g>
        <circle cx="227" cy="179" r="14" stroke="#bfceb0" opacity=".5" />
        <path
          d="M242 179H360M106 203H32"
          stroke="#89967c"
          strokeWidth=".7"
          strokeDasharray="3 3"
        />
        <text x="292" y="170" fill="#a2af95" fontSize="8" letterSpacing="1">
          VESSEL STRUCTURE
        </text>
        <text x="23" y="220" fill="#a2af95" fontSize="8">
          BRANCH 02
        </text>
        <path
          d="M16 35V16H35M385 16H404V35M404 305V324H385M35 324H16V305"
          stroke="#6a765e"
        />
      </svg>
      {caption && (
        <span className="art-caption">ILLUSTRATIVE VASCULAR SCHEMATIC</span>
      )}
    </div>
  );
}
