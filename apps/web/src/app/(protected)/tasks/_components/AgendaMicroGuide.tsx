"use client";

import React from "react";

interface AgendaMicroGuideProps {
  onDismiss: () => void;
}

const AgendaMicroGuide: React.FC<AgendaMicroGuideProps> = ({ onDismiss }) => {
  return (
    <div className="sn-card sn-card--muted p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Astuce</div>
          <div className="text-sm text-muted-foreground">
            Ajoute un titre simple, puis un rappel si besoin. Tu peux épingler l’essentiel en favori ⭐.
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="sn-text-btn shrink-0"
        >
          Compris
        </button>
      </div>
    </div>
  );
};

export default AgendaMicroGuide;
