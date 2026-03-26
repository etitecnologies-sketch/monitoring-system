export default function MetricCard({ host, cpu, memory }) {
  const cpuColor = cpu > 90 ? "red" : cpu > 70 ? "orange" : "green";
  const memColor = memory > 90 ? "red" : memory > 70 ? "orange" : "green";

  return (
    <div className="metric-card">
      <h2>{host}</h2>
      <div className="metrics-row">
        <div className="metric">
          <span className="label">CPU</span>
          <span className="value" style={{ color: cpuColor }}>
            {cpu.toFixed(1)}%
          </span>
        </div>
        <div className="metric">
          <span className="label">Memory</span>
          <span className="value" style={{ color: memColor }}>
            {memory.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}
