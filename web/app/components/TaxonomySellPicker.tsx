'use client';

import { useEffect, useRef, useState } from 'react';
import {
  breadcrumb,
  type TaxonomyIndex,
  type TaxonomyNode,
} from '@/lib/taxonomy';

export default function TaxonomySellPicker({
  index,
  selectedId,
  onSelect,
}: {
  index: TaxonomyIndex;
  selectedId: string | null;
  onSelect: (node: TaxonomyNode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [atId, setAtId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selected = selectedId ? index.byId.get(selectedId) ?? null : null;
  const at = atId ? index.byId.get(atId) ?? null : null;
  const choices = index.childrenOf(at?.id ?? null);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open, atId]);

  function choose(node: TaxonomyNode) {
    onSelect(node);
    setOpen(false);
  }

  return (
    <div className="taxonomy-sell">
      <button
        type="button"
        className={`taxonomy-sell-trigger${selected ? '' : ' empty'}`}
        aria-expanded={open}
        aria-controls="taxonomy-sell-panel"
        onClick={() => {
          if (!open) {
            const nextAt = selected
              ? (index.childrenOf(selected.id).length ? selected.id : selected.parent_id)
              : null;
            setAtId(nextAt);
          }
          setOpen(!open);
        }}
      >
        <span>{selected ? breadcrumb(index, selected) : 'Choose a category…'}</span>
        <span aria-hidden="true">›</span>
      </button>

      {open && (
        <div
          id="taxonomy-sell-panel"
          className="taxonomy-sell-panel"
          role="region"
          aria-label="Choose a listing category"
          tabIndex={-1}
          ref={panelRef}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          <div className="taxonomy-sell-head">
            {at ? (
              <button type="button" className="linkbtn" onClick={() => setAtId(at.parent_id)}>
                ‹ Back
              </button>
            ) : (
              <strong>All categories</strong>
            )}
            {at && <strong>{breadcrumb(index, at)}</strong>}
            <button
              type="button"
              className="taxonomy-sell-close"
              aria-label="Close category picker"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>

          {at && (
            <button type="button" className="taxonomy-sell-all" onClick={() => choose(at)}>
              Use all {at.name}
            </button>
          )}

          <div className="taxonomy-sell-options">
            {choices.map((node) => {
              const hasChildren = index.childrenOf(node.id).length > 0;
              return (
                <button
                  type="button"
                  key={node.id}
                  aria-pressed={selectedId === node.id}
                  onClick={() => {
                    if (hasChildren) setAtId(node.id);
                    else choose(node);
                  }}
                >
                  <span>{node.icon ? `${node.icon} ` : ''}{node.name}</span>
                  <span aria-hidden="true">{hasChildren ? '›' : selectedId === node.id ? '✓' : ''}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
