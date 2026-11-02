import { useState } from "react";
import { DIFF_STOPS, LCZ_NAMES, VERDICTS, colorFor, embedUrl, fmt, signed, streetViewUrl, type Img, type Sample, type Verdict } from "../lib";

interface Props {
  sample: Sample;
  base: string;
  position: string;
  verdict?: Verdict;
  onVerdict: (v: Verdict | null) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

export default function Detail({ sample: s, base, position, verdict, onVerdict, onPrev, onNext, onClose }: Props) {
  const [zoomed, setZoomed] = useState<string | null>(null);
  const [pano, setPano] = useState<Img | null>(null);
  const embed = pano ? embedUrl(pano) : null;
  return (
    <div className="detail">
      <div className="detail-nav">
        <button onClick={onPrev} aria-label="Previous building">←</button>
        <span>{position}</span>
        <button onClick={onNext} aria-label="Next building">→</button>
        <button onClick={onClose} className="ghost">Close</button>
      </div>

      <div className="detail-heights">
        <div>
          <span className="k">GBA</span>
          <strong>{fmt(s.h)} m</strong>
        </div>
        <div>
          <span className="k">LLM</span>
          <strong>{s.hl == null ? "no estimate" : `${fmt(s.hl)} m`}</strong>
        </div>
        <div>
          <span className="k">Difference</span>
          <strong style={s.dh != null ? { borderBottom: `4px solid ${colorFor(DIFF_STOPS, s.dh)}` } : undefined}>
            {signed(s.dh)} m
          </strong>
        </div>
      </div>

      <div className="verdict" role="group" aria-label="Is the photographed building the one on the map?">
        <span className="k">Is this the building on the map?</span>
        <div>
          {VERDICTS.map((v) => (
            <button key={v.id} className={`${v.id} ${verdict === v.id ? "on" : ""}`} onClick={() => onVerdict(verdict === v.id ? null : v.id)}>
              {v.mark} {v.label}
            </button>
          ))}
        </div>
      </div>

      {s.sliver && (
        <div className="warn">
          <b>Possible wrong building.</b> This footprint is very thin, so the photo may show a neighbouring building instead.
          Check the satellite view before trusting the heights.
        </div>
      )}

      {s.cut && (
        <div className="warn">
          <b>Roof probably out of frame.</b> In every photo, the part of the building that stays in view is about {fmt(s.vt, 0)} m
          high at best, below the LLM's {fmt(s.hl, 0)} m. Treat the LLM height as a lower bound and use the 360° view to see the top.
        </div>
      )}

      <div className="photos">
        {s.imgs.map((im) => (
          <figure key={im.f}>
            <img src={`${base}/img/${im.f}`} alt={`Street view of building ${s.fid}`} loading="lazy" onClick={() => setZoomed(im.f)} />
            <figcaption>
              {im.date} · {im.dist} m · {im.fov}° field of view
              <span className="photo-actions">
                <button onClick={() => setPano(im)}>Explore in 360°</button>
                <a href={streetViewUrl(im.pano)} target="_blank" rel="noreferrer">Open in Google Maps</a>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      <p className="hint">Each photo is aimed at the target building, which should be at the horizontal centre. Neighbouring buildings may appear in frame.</p>

      <dl className="facts">
        <dt>LLM label</dt>
        <dd>
          {s.storeys == null ? "could not judge storeys" : `${s.storeys} storey${s.storeys === 1 ? "" : "s"}`}, {s.use}
          <span className={`badge ${s.conf}`}>{s.conf}</span>
        </dd>
        <dt>Model note</dt>
        <dd>{s.note}</dd>
        {s.alt && (
          <>
            <dt>Second opinion</dt>
            <dd>
              {s.alt.storeys} storey{s.alt.storeys === 1 ? "" : "s"}, {s.alt.use} ({fmt(s.alt.hl)} m)
              <span className={`badge ${s.alt.conf}`}>{s.alt.conf}</span>
              <br />
              <span className="muted">{s.alt.note}</span>
            </dd>
          </>
        )}
        <dt>Context</dt>
        <dd>
          LCZ {s.lcz} {LCZ_NAMES[s.lcz] ? `(${LCZ_NAMES[s.lcz]})` : ""} · target visible in {s.nvis} of {s.imgs.length} views · sample id {s.fid}
        </dd>
      </dl>

      {zoomed && (
        <div className="lightbox" onClick={() => setZoomed(null)}>
          <img src={`${base}/img/${zoomed}`} alt="Enlarged street view" />
        </div>
      )}

      {pano && (
        <div className="lightbox pano" onClick={() => setPano(null)}>
          <div className="pano-card" onClick={(e) => e.stopPropagation()}>
            <div className="pano-head">
              <span>Building #{s.fid} · {pano.date} · drag to look around, tilt up to see the roof</span>
              <button onClick={() => setPano(null)}>Close</button>
            </div>
            {embed ? (
              <iframe title="Interactive Street View" src={embed} allowFullScreen loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
            ) : (
              <div className="pano-missing">
                <p>The embedded 360° view needs a Google Maps Embed API key (free), which isn't configured in this build.</p>
                <a href={streetViewUrl(pano.pano)} target="_blank" rel="noreferrer">Open this panorama in Google Maps instead</a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
