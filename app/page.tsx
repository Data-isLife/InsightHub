"use client";

import { useState } from "react";

type Stat = {
  label: string;
  value: string;
  description: string;
};

const stats: Stat[] = [
  { label: "Total datasets", 
    value: "12", 
    description: "Prototype records" 
  },
  { label: "Rows analysed", 
    value: "45,000", 
    description: "Sample data" 
  },
  { label: "Reports generated", 
    value: "8", 
    description: "Prototype reports" 
  },
  { label: "Storage used", 
    value: "250 MB", 
    description: "Prototype Data"
  },
  {
  label: "Active projects",
  value: "4",
  description: "Projects in progress",
  }
];

export default function Home() {
  const [count, setCount] = useState<number>(0);
  const statusMessage =
              count === 0
              ? "No datasets uploaded"
              : count < 5
              ? "Getting started"
              : count < 10
              ? "Growing Workspace"
              : "Active Workspace";
  return (
    <main className="dashboard">
      <aside className="sidebar">
        <h2>InsightHub.</h2>
        <p className="menu-title">WORKSPACE</p>
        <nav>
          <a className="active" href="#">Dashboard</a>
          <a href="#">My datasets</a>
          <a href="#">Analysis</a>
          <a href="#">Reports</a>
          <a href="#">Settings</a>
        </nav>
        <div className="sidebar-footer">
          Data intelligence, simplified.
        </div>
      </aside>

      <section className="main-content">
        <header className="topbar">
          <span>InsightHub / Dashboard</span>
          <span>My Workspace</span>
        </header>

        <div className="content">          
          <div className="welcome">
            <div>
              <h1>Welcome to InsightHub</h1>
              <p>Your data analysis workspace.</p>
            </div>
            <button>+ New analysis</button>
          </div>

          <div className="stats">
            {stats.map((stat) => (
              <article className="stat-card" key={stat.label}>
                <p>{stat.label}</p>
                <h2>{stat.value}</h2>
                <small>{stat.description}</small>
              </article>
            ))}
          </div>

          <section className="recent">
            <h2>Dataset Activity Tracker</h2>

            <p>Track your dataset activity with the buttons below.</p>

            <h2 className="counter-value">{count}</h2>
            
            <p>
              {statusMessage}
            </p>

            <div className="counter-controls">
              <button
                type="button"
                onClick={() => setCount((current) => Math.max(0,current - 1))}
              >
                Decrease
              </button>

              <button
                type="button"
                onClick={() => setCount((current) => current + 1)}
              >
                Increase
              </button>

              <button
                type="button"
                onClick={() => setCount(0)}
              >
                Reset
              </button>
            </div>
          </section>

          <section className="upload-card">
            <h2>Start analysing your data</h2>
            <p>
              Upload a CSV or Excel dataset to begin
              exploring your information.
            </p>
            <div className="upload-area">
              <div className="upload-icon">↑</div>
              <strong>Drop your dataset here</strong>
              <p>CSV and Excel files will be supported.</p>
              <button>Choose a file</button>
            </div>
          </section>

          <section className="recent">
            <h2>Recent datasets</h2>
            <p>No datasets available yet.</p>
          </section>
        </div>
      </section>
    </main>
  );
}
