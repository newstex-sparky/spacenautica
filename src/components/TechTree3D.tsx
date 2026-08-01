import { useEffect, useRef, useState } from 'react';
import { TechTreeNode, TECH_TREE_NODES, canResearchNode, researchNode } from '../models/techtree/data';
import './TechTree.css';

export default function TechTree3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [researchPoints, setResearchPoints] = useState(0);
  const [activeCategory, setActiveCategory] = useState<TechTreeNode['category']>('basic');
  const [completedNodeIds, setCompletedNodeIds] = useState<Set<string>>(new Set());
  const [researchingNodeId, setResearchingNodeId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Filter nodes by category
  const filteredNodes = TECH_TREE_NODES.filter(node => node.category === activeCategory);

  // Available nodes (not completed, not locked)
  const availableNodes = filteredNodes.filter(node =>
    !completedNodeIds.has(node.id) &&
    canResearchNode(node, Array.from(completedNodeIds))
  );

  // Locked nodes (requirements not met)
  const lockedNodes = filteredNodes.filter(node =>
    !completedNodeIds.has(node.id) &&
    !availableNodes.some(a => a.id === node.id)
  );

  // Complete nodes
  const completedNodes = filteredNodes.filter(node => completedNodeIds.has(node.id));

  // Handle research
  const handleResearch = async (nodeId: string) => {
    const node = TECH_TREE_NODES.find(n => n.id === nodeId);
    if (!node) return;

    setResearchingNodeId(nodeId);
    setMessage(`Researching ${node.name}...`);

    // Simulate research time
    await new Promise(resolve => setTimeout(resolve, 1000));

    const result = researchNode(nodeId, node.cost, completedNodeIds);

    setCompletedNodeIds(prev => new Set([...prev, nodeId]));
    setResearchPoints(prev => prev + node.cost);
    setResearchingNodeId(null);

    if (result.newUnlocks.length > 0) {
      setMessage(`Research complete! Unlocked: ${result.newUnlocks.length} technologies`);
    } else {
      setMessage(`Research complete!`);
    }

    setTimeout(() => setMessage(null), 3000);
  };

  // Close tech tree
  const handleClose = () => {
    if (typeof window !== 'undefined' && document.pointerLockElement) {
      document.exitPointerLock();
    }
  };

  // Render category tabs
  const categories: { id: TechTreeNode['category']; label: string; color: string }[] = [
    { id: 'basic', label: 'Basic', color: '#00ffcc' },
    { id: 'survival', label: 'Survival', color: '#00ff88' },
    { id: 'manufacturing', label: 'Manufacturing', color: '#ffaa00' },
    { id: 'communication', label: 'Communication', color: '#0088ff' },
    { id: 'special', label: 'Special', color: '#ff00ff' }
  ];

  return (
    <div>
      {/* Tech tree UI overlay */}
      <div className="tech-tree-container" ref={containerRef}>
        <div className="tech-tree-title">TECH RESEARCH INTERFACE</div>
        <div className="tech-tree-subtitle">Select technologies to advance your station</div>

        {/* Category tabs */}
        <div className="tech-tree-category-tabs">
          {categories.map(cat => (
            <button
              key={cat.id}
              className={`tech-tree-tab ${activeCategory === cat.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
              style={{ borderColor: cat.id === 'special' ? '#ff00ff' : cat.color }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Research resource panel */}
        <div className="tech-tree-resource-panel">
          <div className="tech-tree-resource-title">Research Points</div>
          <div className="tech-tree-research-points">{researchPoints}</div>
        </div>

        {/* Nodes container */}
        <div className="tech-tree-nodes">
          {/* Available nodes */}
          {availableNodes.map(node => (
            <div key={node.id} className="tech-tree-node available">
              <div className="tech-tree-node-name">{node.name}</div>
              <div className="tech-tree-node-category" style={{ color: categories.find(c => c.id === node.category)?.color }}>
                {node.category}
              </div>
              <div className="tech-tree-node-description">{node.description}</div>
              <div className="tech-tree-node-cost">
                Cost: {node.cost} points
              </div>
              <div className="tech-tree-progress">
                <div
                  className="tech-tree-progress-bar"
                  style={{ width: `${(node.researchProgress / node.cost) * 100}%` }}
                />
              </div>
              <button
                className="tech-tree-research-btn"
                onClick={() => handleResearch(node.id)}
                disabled={researchingNodeId === node.id}
              >
                {researchingNodeId === node.id ? 'Researching...' : 'RESEARCH'}
              </button>
              {!node.unlock.includes('special-1') && (
                <div className="tech-tree-node-unlocks">
                  <h3>Unlocks:</h3>
                  <ul className="tech-tree-unlock-list">
                    {node.unlock
                      .filter(unlockId => completedNodeIds.has(unlockId))
                      .map(unlockId => (
                        <li key={unlockId}>{unlockId}</li>
                      ))}
                  </ul>
                </div>
              )}
            </div>
          ))}

          {/* Locked nodes */}
          {lockedNodes.length > 0 && (
            <div style={{ gridColumn: 'span 2' }}>
              <h3 style={{ color: '#ff6600', marginBottom: '10px', textAlign: 'center' }}>
                LOCKED (Complete prerequisites first)
              </h3>
              {lockedNodes.map(node => (
                <div key={node.id} className="tech-tree-node locked">
                  <div className="tech-tree-node-name">{node.name}</div>
                  <div className="tech-tree-node-category">LOCKED</div>
                  <div className="tech-tree-node-description">
                    Requires: {node.requires || 'None'}
                  </div>
                  <div className="tech-tree-node-cost">
                    Cost: {node.cost} points
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Completed nodes */}
          {completedNodes.length > 0 && (
            <div style={{ gridColumn: 'span 2' }}>
              <h3 style={{ color: '#00ffcc', marginBottom: '10px', textAlign: 'center' }}>
                COMPLETED TECHNOLOGIES
              </h3>
              {completedNodes.map(node => (
                <div key={node.id} className="tech-tree-node completed">
                  <div className="tech-tree-node-name">{node.name}</div>
                  <div className="tech-tree-node-category" style={{ color: '#00ff88' }}>
                    Completed
                  </div>
                  <div className="tech-tree-node-description">{node.description}</div>
                  <button
                    className="tech-tree-research-btn"
                    disabled
                    style={{ borderColor: '#00ffcc', backgroundColor: 'rgba(0, 255, 200, 0.3)' }}
                  >
                    RESEARCHED
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Close button */}
        <button className="tech-tree-close" onClick={handleClose}>
          CLOSE (ESC)
        </button>

        {/* Message */}
        {message && (
          <div className="tech-tree-message">{message}</div>
        )}
      </div>
    </div>
  );
}