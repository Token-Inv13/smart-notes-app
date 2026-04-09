"use client";

import React from "react";
import { normalizeDisplayText } from "@/lib/normalizeText";
import type { TaskDoc } from "@/types/firestore";

interface CompletedTasksSectionProps {
  tasks: TaskDoc[];
  toggleDone: (task: TaskDoc, done: boolean) => void;
}

const CompletedTasksSection: React.FC<CompletedTasksSectionProps> = ({
  tasks,
  toggleDone,
}) => {
  if (!tasks || tasks.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold mt-6 mb-2">Terminées</h2>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="sn-card sn-card--task sn-card--muted p-4">
            <div className="sn-card-header">
              <div className="min-w-0">
                <div className="sn-card-title truncate">{normalizeDisplayText(task.title)}</div>
                <div className="sn-card-meta"><span className="sn-badge">Terminée</span></div>
              </div>
              <div className="sn-card-actions">
                <button type="button" onClick={() => toggleDone(task, false)} className="sn-text-btn">
                  Restaurer
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default CompletedTasksSection;
