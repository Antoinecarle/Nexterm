import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { api } from '../api';

const NODE_COLORS = {
  project: '#6366f1',
  plugin: '#8b5cf6',
  skill: '#10b981',
  agent: '#f59e0b',
};

const NODE_GLOW = {
  project: 'rgba(99, 102, 241, 0.4)',
  plugin: 'rgba(139, 92, 246, 0.4)',
  skill: 'rgba(16, 185, 129, 0.4)',
  agent: 'rgba(245, 158, 11, 0.4)',
};

const NODE_SIZES = {
  project: 32,
  plugin: 26,
  skill: 20,
  agent: 20,
};

const CORE_SIZE = 52;

function nodeSize(d) {
  return d.isCore ? CORE_SIZE : NODE_SIZES[d.type];
}

const LINK_COLORS = {
  uses: 'rgba(139, 92, 246, 0.25)',
  contains: 'rgba(16, 185, 129, 0.18)',
  manual: 'rgba(245, 158, 11, 0.35)',
};

// SVG icon paths for each node type
const NODE_ICONS = {
  project: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  plugin: 'M13 2L3 14h9l-1 8 10-12h-9l1-8',
  skill: 'M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z',
  agent: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
};

export default function Mindmap() {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const simulationRef = useRef(null);
  const nodesRef = useRef([]);
  const [graphData, setGraphData] = useState({ nodes: [], links: [], positions: {} });
  const [selectedNode, setSelectedNode] = useState(null);
  const [linkMode, setLinkMode] = useState(false);
  const [linkSource, setLinkSource] = useState(null);
  const [filters, setFilters] = useState({ projects: true, plugins: true, skills: true, agents: true });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const [modalData, setModalData] = useState({});
  const [aiLoading, setAiLoading] = useState(false);
  const [addAgentTab, setAddAgentTab] = useState('existing');
  const [allAgents, setAllAgents] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [ctxAgentPicker, setCtxAgentPicker] = useState(null);
  const [editingAgent, setEditingAgent] = useState(null); // { description, model, prompt }
  const [agentSaving, setAgentSaving] = useState(false);
  const saveTimerRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const data = await api('/api/mindmap/data');
      setGraphData(data);
    } catch (err) {
      console.error('Failed to load mindmap data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Close context menu on click anywhere
  useEffect(() => {
    const close = () => { setContextMenu(null); setCtxAgentPicker(null); };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        setSelectedNode(null);
        setContextMenu(null);
        setModal(null);
        if (linkMode) {
          setLinkMode(false);
          setLinkSource(null);
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [linkMode]);

  const savePositions = useCallback((nodes) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const positions = nodes.map((n) => ({ node_id: n.id, x: n.x, y: n.y }));
        await api('/api/mindmap/positions', {
          method: 'POST',
          body: JSON.stringify({ positions }),
        });
      } catch (_) {}
    }, 2000);
  }, []);

  const handleLink = useCallback(async (source, target) => {
    try {
      await api('/api/mindmap/link', {
        method: 'POST',
        body: JSON.stringify({ source, target }),
      });
      await fetchData();
    } catch (err) {
      console.error('Link failed:', err);
    }
  }, [fetchData]);

  const handleUnlink = useCallback(async (source, target) => {
    try {
      await api('/api/mindmap/link', {
        method: 'DELETE',
        body: JSON.stringify({ source, target }),
      });
      setSelectedNode(null);
      await fetchData();
    } catch (err) {
      console.error('Unlink failed:', err);
    }
  }, [fetchData]);

  const handleCreateAgent = async () => {
    try {
      await api('/api/mindmap/create-agent', {
        method: 'POST',
        body: JSON.stringify(modalData),
      });
      setModal(null);
      setModalData({});
      await fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCreateSkill = async () => {
    try {
      await api('/api/mindmap/create-skill', {
        method: 'POST',
        body: JSON.stringify(modalData),
      });
      setModal(null);
      setModalData({});
      await fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteAgent = async (name) => {
    if (!confirm(`Delete agent "${name}"?`)) return;
    try {
      await api(`/api/mindmap/agent/${name}`, { method: 'DELETE' });
      setSelectedNode(null);
      setContextMenu(null);
      await fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteSkill = async (name) => {
    if (!confirm(`Delete skill "${name}"?`)) return;
    try {
      await api(`/api/mindmap/skill/${name}`, { method: 'DELETE' });
      setSelectedNode(null);
      setContextMenu(null);
      await fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleAiAssist = async () => {
    if (!modalData.name) return;
    setAiLoading(true);
    try {
      const result = await api('/api/mindmap/assist-agent', {
        method: 'POST',
        body: JSON.stringify({
          name: modalData.name,
          description: modalData.description || '',
          currentPrompt: modalData.prompt || '',
        }),
      });
      setModalData((prev) => ({
        ...prev,
        prompt: result.prompt,
        description: result.description || prev.description || '',
      }));
    } catch (err) {
      alert('AI generation failed: ' + err.message);
    } finally {
      setAiLoading(false);
    }
  };

  const fetchAllAgents = async () => {
    setAgentsLoading(true);
    try {
      const agents = await api('/api/mindmap/agents/all');
      setAllAgents(agents);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
    } finally {
      setAgentsLoading(false);
    }
  };

  const openAgentPickerForProject = async (projectNode, x, y) => {
    setCtxAgentPicker({ projectNode, x, y, agents: [], loading: true });
    try {
      const agents = await api('/api/mindmap/agents/all');
      // Filter: only active agents not already linked to this project
      const linkedAgentIds = new Set(
        graphData.links
          .filter((l) => l.source === projectNode.id && l.target.startsWith('agent:'))
          .map((l) => l.target.replace('agent:', ''))
      );
      const available = agents.filter((a) => a.active && !linkedAgentIds.has(a.name));
      setCtxAgentPicker((prev) => prev ? { ...prev, agents: available, loading: false } : null);
    } catch (err) {
      console.error('Failed to fetch agents:', err);
      setCtxAgentPicker(null);
    }
  };

  const handlePickAgentForProject = async (projectNode, agentName) => {
    try {
      await api('/api/mindmap/link', {
        method: 'POST',
        body: JSON.stringify({ source: projectNode.id, target: `agent:${agentName}` }),
      });
      setCtxAgentPicker(null);
      await fetchData();
    } catch (err) {
      alert('Failed to link agent: ' + err.message);
    }
  };

  const handleActivateAgent = async (name) => {
    try {
      await api('/api/mindmap/agents/activate', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await fetchAllAgents();
      await fetchData();
    } catch (err) {
      alert('Failed to activate agent: ' + err.message);
    }
  };

  const handleDeactivateAgent = async (name) => {
    try {
      await api('/api/mindmap/agents/deactivate', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setSelectedNode(null);
      setContextMenu(null);
      await fetchAllAgents();
      await fetchData();
    } catch (err) {
      alert('Failed to deactivate agent: ' + err.message);
    }
  };

  const handleStartEditAgent = (node) => {
    setEditingAgent({
      description: node.description || '',
      model: node.model || '',
      prompt: node.prompt || '',
    });
  };

  const handleSaveAgent = async (name) => {
    if (!editingAgent) return;
    setAgentSaving(true);
    try {
      await api(`/api/mindmap/agent/${name}`, {
        method: 'PUT',
        body: JSON.stringify(editingAgent),
      });
      setEditingAgent(null);
      await fetchData();
      // Update selectedNode with new data
      setSelectedNode((prev) => prev ? { ...prev, ...editingAgent } : null);
    } catch (err) {
      alert('Failed to save agent: ' + err.message);
    } finally {
      setAgentSaving(false);
    }
  };

  // D3 rendering
  useEffect(() => {
    if (!svgRef.current || !containerRef.current || loading) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    svg.attr('width', width).attr('height', height);

    // Defs for gradients and filters
    const defs = svg.append('defs');

    // Glow filters per type
    Object.entries(NODE_GLOW).forEach(([type, color]) => {
      const filter = defs.append('filter')
        .attr('id', `glow-${type}`)
        .attr('x', '-50%').attr('y', '-50%')
        .attr('width', '200%').attr('height', '200%');
      filter.append('feGaussianBlur').attr('stdDeviation', '6').attr('result', 'blur');
      filter.append('feFlood').attr('flood-color', color).attr('result', 'color');
      filter.append('feComposite').attr('in', 'color').attr('in2', 'blur').attr('operator', 'in').attr('result', 'glow');
      const merge = filter.append('feMerge');
      merge.append('feMergeNode').attr('in', 'glow');
      merge.append('feMergeNode').attr('in', 'SourceGraphic');
    });

    // Strong glow for hover
    Object.entries(NODE_GLOW).forEach(([type, color]) => {
      const filter = defs.append('filter')
        .attr('id', `glow-hover-${type}`)
        .attr('x', '-80%').attr('y', '-80%')
        .attr('width', '260%').attr('height', '260%');
      filter.append('feGaussianBlur').attr('stdDeviation', '12').attr('result', 'blur');
      filter.append('feFlood').attr('flood-color', color).attr('result', 'color');
      filter.append('feComposite').attr('in', 'color').attr('in2', 'blur').attr('operator', 'in').attr('result', 'glow');
      const merge = filter.append('feMerge');
      merge.append('feMergeNode').attr('in', 'glow');
      merge.append('feMergeNode').attr('in', 'SourceGraphic');
    });

    // Arrow marker for links
    defs.append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 30).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('fill', 'rgba(255,255,255,0.15)')
      .attr('d', 'M0,-5L10,0L0,5');

    // Filter nodes by type
    const typeMap = { project: 'projects', plugin: 'plugins', skill: 'skills', agent: 'agents' };
    let filteredNodes = graphData.nodes.filter((n) => filters[typeMap[n.type]]);

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      filteredNodes = filteredNodes.filter(
        (n) => n.name.toLowerCase().includes(q) || (n.description || '').toLowerCase().includes(q)
      );
    }

    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredLinks = graphData.links.filter(
      (l) => nodeIds.has(l.source) && nodeIds.has(l.target)
    );

    // Clone data for D3 mutation
    const nodes = filteredNodes.map((n) => {
      const pos = graphData.positions[n.id];
      const clone = { ...n, x: pos ? pos.x : undefined, y: pos ? pos.y : undefined };
      // Pin nexterm core node to center
      if (n.isCore) {
        clone.fx = width / 2;
        clone.fy = height / 2;
      }
      return clone;
    });
    const links = filteredLinks.map((l) => ({ ...l }));
    nodesRef.current = nodes;

    // Zoom
    const g = svg.append('g');
    const zoomBehavior = d3.zoom().scaleExtent([0.1, 5]).on('zoom', (e) => {
      g.attr('transform', e.transform);
    });
    svg.call(zoomBehavior);
    // Store zoom for external use
    svg.node().__zoom_behavior = zoomBehavior;

    // Background grid pattern
    const gridSize = 40;
    const gridPattern = defs.append('pattern')
      .attr('id', 'grid')
      .attr('width', gridSize).attr('height', gridSize)
      .attr('patternUnits', 'userSpaceOnUse');
    gridPattern.append('circle')
      .attr('cx', gridSize / 2).attr('cy', gridSize / 2)
      .attr('r', 0.5)
      .attr('fill', 'rgba(255,255,255,0.04)');

    g.append('rect')
      .attr('x', -5000).attr('y', -5000)
      .attr('width', 10000).attr('height', 10000)
      .attr('fill', 'url(#grid)');

    // Links - curved paths
    const link = g
      .append('g')
      .attr('class', 'links-layer')
      .selectAll('path')
      .data(links)
      .join('path')
      .attr('class', (d) => `mindmap-link mindmap-link-${d.type || 'default'}`)
      .attr('fill', 'none')
      .attr('stroke', (d) => LINK_COLORS[d.type] || 'rgba(255,255,255,0.08)')
      .attr('stroke-width', (d) => d.type === 'contains' ? 1 : d.type === 'manual' ? 2.5 : 1.5)
      .attr('stroke-dasharray', (d) => d.type === 'contains' ? '4,4' : 'none')
      .attr('marker-end', (d) => d.type === 'uses' ? 'url(#arrow)' : null);

    // Nodes group
    const node = g
      .append('g')
      .attr('class', 'nodes-layer')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', (d) => `mindmap-node mindmap-node-${d.type}`)
      .style('cursor', 'grab');

    // Outer glow ring (always visible, subtle)
    node.append('circle')
      .attr('class', 'node-glow-ring')
      .attr('r', (d) => nodeSize(d) + 8)
      .attr('fill', 'none')
      .attr('stroke', (d) => NODE_COLORS[d.type])
      .attr('stroke-width', (d) => d.isCore ? 2 : 1)
      .attr('stroke-opacity', (d) => d.isCore ? 0.35 : 0.15);

    // Extra outer ring for core node
    node.filter((d) => d.isCore).append('circle')
      .attr('class', 'node-glow-ring-outer')
      .attr('r', (d) => nodeSize(d) + 18)
      .attr('fill', 'none')
      .attr('stroke', NODE_COLORS.project)
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.12)
      .attr('stroke-dasharray', '6,4');

    // Main node shape
    node.each(function (d) {
      const el = d3.select(this);
      if (d.type === 'plugin') {
        const r = NODE_SIZES.plugin;
        const hex = d3.range(6).map((i) => {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          return [r * Math.cos(angle), r * Math.sin(angle)];
        });
        el.append('polygon')
          .attr('class', 'node-shape')
          .attr('points', hex.map((p) => p.join(',')).join(' '))
          .attr('fill', NODE_COLORS.plugin)
          .attr('fill-opacity', 0.2)
          .attr('stroke', NODE_COLORS.plugin)
          .attr('stroke-width', 2);
      } else {
        const r = nodeSize(d);
        el.append('circle')
          .attr('class', 'node-shape')
          .attr('r', r)
          .attr('fill', NODE_COLORS[d.type])
          .attr('fill-opacity', d.isCore ? 0.35 : 0.2)
          .attr('stroke', NODE_COLORS[d.type])
          .attr('stroke-width', d.isCore ? 3 : 2);
        if (d.isCore) {
          el.select('.node-shape').attr('filter', `url(#glow-${d.type})`);
        }
      }
    });

    // Inner icon
    node.append('path')
      .attr('d', (d) => NODE_ICONS[d.type])
      .attr('fill', 'none')
      .attr('stroke', (d) => NODE_COLORS[d.type])
      .attr('stroke-width', 1.5)
      .attr('stroke-linecap', 'round')
      .attr('stroke-linejoin', 'round')
      .attr('stroke-opacity', 0.8)
      .attr('transform', (d) => {
        const s = nodeSize(d) / 22;
        return `translate(${-12 * s},${-12 * s}) scale(${s})`;
      });

    // MCP badge for plugins
    node.filter((d) => d.type === 'plugin' && d.isMcp)
      .append('circle')
      .attr('cx', NODE_SIZES.plugin - 4)
      .attr('cy', -NODE_SIZES.plugin + 4)
      .attr('r', 6)
      .attr('fill', '#8b5cf6')
      .attr('stroke', '#0a0b10')
      .attr('stroke-width', 2);

    node.filter((d) => d.type === 'plugin' && d.isMcp)
      .append('text')
      .text('M')
      .attr('x', NODE_SIZES.plugin - 4)
      .attr('y', -NODE_SIZES.plugin + 7)
      .attr('text-anchor', 'middle')
      .attr('fill', 'white')
      .attr('font-size', '7px')
      .attr('font-weight', '700')
      .attr('pointer-events', 'none');

    // Labels with background
    const labelGroup = node.append('g')
      .attr('class', 'node-label-group')
      .attr('transform', (d) => `translate(0, ${nodeSize(d) + 16})`);

    labelGroup.append('text')
      .attr('class', 'node-label-bg')
      .text((d) => d.name)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--bg)')
      .attr('font-size', (d) => d.isCore ? '14px' : '11px')
      .attr('font-weight', (d) => d.isCore ? '700' : '500')
      .attr('stroke', 'var(--bg)')
      .attr('stroke-width', 3)
      .attr('paint-order', 'stroke')
      .attr('pointer-events', 'none');

    labelGroup.append('text')
      .attr('class', 'node-label')
      .text((d) => d.name)
      .attr('text-anchor', 'middle')
      .attr('fill', (d) => d.isCore ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.75)')
      .attr('font-size', (d) => d.isCore ? '14px' : '11px')
      .attr('font-weight', (d) => d.isCore ? '700' : '500')
      .attr('pointer-events', 'none');

    // Scope badge for plugins
    node.filter((d) => d.type === 'plugin' && d.scope)
      .append('text')
      .text((d) => d.scope)
      .attr('dy', -NODE_SIZES.plugin - 10)
      .attr('text-anchor', 'middle')
      .attr('fill', 'rgba(139, 92, 246, 0.5)')
      .attr('font-size', '9px')
      .attr('font-weight', '600')
      .attr('pointer-events', 'none');

    // Connection count badge
    node.each(function (d) {
      const connCount = links.filter((l) => {
        const src = typeof l.source === 'object' ? l.source.id : l.source;
        const tgt = typeof l.target === 'object' ? l.target.id : l.target;
        return src === d.id || tgt === d.id;
      }).length;
      if (connCount > 0) {
        const el = d3.select(this);
        const r = nodeSize(d);
        el.append('circle')
          .attr('cx', r - 2).attr('cy', -(r - 2))
          .attr('r', 8)
          .attr('fill', 'rgba(0,0,0,0.7)')
          .attr('stroke', NODE_COLORS[d.type])
          .attr('stroke-width', 1.5);
        el.append('text')
          .text(connCount)
          .attr('x', r - 2).attr('y', -(r - 6))
          .attr('text-anchor', 'middle')
          .attr('fill', 'white')
          .attr('font-size', '8px')
          .attr('font-weight', '700')
          .attr('pointer-events', 'none');
      }
    });

    // --- Interactions ---

    // Hover: highlight connected nodes
    node.on('mouseenter', function (event, d) {
      const el = d3.select(this);
      el.select('.node-shape').attr('filter', `url(#glow-hover-${d.type})`);
      el.raise();

      // Dim non-connected nodes
      const connectedIds = new Set([d.id]);
      links.forEach((l) => {
        const src = typeof l.source === 'object' ? l.source.id : l.source;
        const tgt = typeof l.target === 'object' ? l.target.id : l.target;
        if (src === d.id) connectedIds.add(tgt);
        if (tgt === d.id) connectedIds.add(src);
      });

      node.style('opacity', (n) => connectedIds.has(n.id) ? 1 : 0.2);
      link.style('opacity', (l) => {
        const src = typeof l.source === 'object' ? l.source.id : l.source;
        const tgt = typeof l.target === 'object' ? l.target.id : l.target;
        return src === d.id || tgt === d.id ? 1 : 0.05;
      });
      link.attr('stroke-width', (l) => {
        const src = typeof l.source === 'object' ? l.source.id : l.source;
        const tgt = typeof l.target === 'object' ? l.target.id : l.target;
        if (src === d.id || tgt === d.id) return l.type === 'contains' ? 2 : 3;
        return l.type === 'contains' ? 1 : 1.5;
      });
    });

    node.on('mouseleave', function () {
      d3.select(this).select('.node-shape').attr('filter', null);
      node.style('opacity', 1);
      link.style('opacity', 1);
      link.attr('stroke-width', (d) => d.type === 'contains' ? 1 : d.type === 'manual' ? 2.5 : 1.5);
    });

    // Click handler
    node.on('click', (event, d) => {
      event.stopPropagation();
      if (linkMode) {
        if (!linkSource) {
          if (d.type === 'project') {
            setLinkSource(d);
          }
        } else {
          if ((d.type === 'skill' || d.type === 'agent') && linkSource.id !== d.id) {
            handleLink(linkSource.id, d.id);
            setLinkSource(null);
            setLinkMode(false);
          }
        }
      } else {
        setSelectedNode(d);
        setContextMenu(null);
      }
    });

    // Right-click context menu
    node.on('contextmenu', (event, d) => {
      event.preventDefault();
      event.stopPropagation();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        node: d,
      });
    });

    svg.on('contextmenu', (event) => {
      // Allow right-click on SVG itself or the grid background rect
      const tag = event.target.tagName;
      if (event.target === svgRef.current || tag === 'svg' || tag === 'rect') {
        event.preventDefault();
        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          node: null,
        });
      }
    });

    svg.on('click', (event) => {
      if (event.target === svgRef.current || event.target.tagName === 'rect') {
        if (!linkMode) setSelectedNode(null);
        setContextMenu(null);
      }
    });

    // Drag (core node stays pinned to center)
    const drag = d3.drag()
      .on('start', (event, d) => {
        if (d.isCore) return;
        if (!event.active) simulationRef.current.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        if (d.isCore) return;
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (d.isCore) return;
        if (!event.active) simulationRef.current.alphaTarget(0);
        d.fx = null;
        d.fy = null;
        savePositions(nodes);
      });
    node.call(drag);

    // Simulation with radial layout around core
    const simulation = d3
      .forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).distance((d) => {
        const src = typeof d.source === 'object' ? d.source : nodes.find((n) => n.id === d.source);
        const tgt = typeof d.target === 'object' ? d.target : nodes.find((n) => n.id === d.target);
        if ((src && src.isCore) || (tgt && tgt.isCore)) return 350;
        if (d.type === 'contains') return 200;
        if (d.type === 'uses') return 300;
        if (d.type === 'manual') return 280;
        return 250;
      }).strength((d) => {
        const src = typeof d.source === 'object' ? d.source : nodes.find((n) => n.id === d.source);
        if (src && src.isCore) return 0.15;
        return d.type === 'contains' ? 0.4 : 0.2;
      }))
      .force('charge', d3.forceManyBody().strength(-2000).distanceMax(1500))
      .force('collision', d3.forceCollide().radius((d) => nodeSize(d) + 60).strength(1))
      .force('radial', d3.forceRadial(
        (d) => d.isCore ? 0 : d.type === 'project' ? 350 : 600,
        width / 2, height / 2
      ).strength((d) => d.isCore ? 0 : d.type === 'project' ? 0.3 : 0.08))
      .alphaDecay(0.015)
      .on('tick', () => {
        // Curved links
        link.attr('d', (d) => {
          const dx = d.target.x - d.source.x;
          const dy = d.target.y - d.source.y;
          const dr = Math.sqrt(dx * dx + dy * dy) * 0.8;
          return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
        });
        node.attr('transform', (d) => `translate(${d.x},${d.y})`);
      });

    simulationRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [graphData, filters, search, loading, linkMode, linkSource, handleLink, savePositions]);

  // Get connections for selected node
  const getConnections = (node) => {
    if (!node) return [];
    return graphData.links
      .filter((l) => l.source === node.id || l.target === node.id)
      .map((l) => {
        const otherId = l.source === node.id ? l.target : l.source;
        const otherNode = graphData.nodes.find((n) => n.id === otherId);
        return otherNode
          ? { ...otherNode, linkSource: l.source, linkTarget: l.target, linkType: l.type }
          : null;
      })
      .filter(Boolean);
  };

  const toggleFilter = (key) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const zoomIn = () => {
    const svg = d3.select(svgRef.current);
    svg.transition().duration(300).call(svg.node().__zoom_behavior.scaleBy, 1.3);
  };

  const zoomOut = () => {
    const svg = d3.select(svgRef.current);
    svg.transition().duration(300).call(svg.node().__zoom_behavior.scaleBy, 0.7);
  };

  const zoomReset = () => {
    const svg = d3.select(svgRef.current);
    svg.transition().duration(500).call(svg.node().__zoom_behavior.transform, d3.zoomIdentity);
  };

  const zoomToFit = () => {
    const svg = d3.select(svgRef.current);
    const nodes = nodesRef.current;
    if (!nodes.length) return;
    const padding = 80;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    const xExtent = d3.extent(nodes, (d) => d.x);
    const yExtent = d3.extent(nodes, (d) => d.y);
    const dx = (xExtent[1] || 0) - (xExtent[0] || 0) + padding * 2;
    const dy = (yExtent[1] || 0) - (yExtent[0] || 0) + padding * 2;
    const scale = Math.min(width / dx, height / dy, 2);
    const cx = ((xExtent[0] || 0) + (xExtent[1] || 0)) / 2;
    const cy = ((yExtent[0] || 0) + (yExtent[1] || 0)) / 2;
    svg.transition().duration(500).call(
      svg.node().__zoom_behavior.transform,
      d3.zoomIdentity.translate(width / 2, height / 2).scale(scale).translate(-cx, -cy)
    );
  };

  // Count nodes per type
  const typeCounts = {};
  graphData.nodes.forEach((n) => {
    typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
  });

  if (loading) {
    return (
      <div className="page mindmap-page">
        <div className="mindmap-loading">
          <div className="mindmap-loading-spinner" />
          Loading mindmap...
        </div>
      </div>
    );
  }

  return (
    <div className="page mindmap-page">
      <header className="mindmap-header">
        <div className="mindmap-header-left">
          <h2 className="page-title">Mindmap</h2>
          <span className="mindmap-node-count">{graphData.nodes.length} nodes</span>
        </div>
        <div className="mindmap-controls">
          <button
            className={`btn btn-sm ${linkMode ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setLinkMode(!linkMode); setLinkSource(null); }}
          >
            {linkMode ? 'Cancel Link' : 'Link'}
          </button>
          <div className="mindmap-zoom-controls">
            <button className="btn btn-xs btn-ghost" onClick={zoomOut} title="Zoom out">−</button>
            <button className="btn btn-xs btn-ghost" onClick={zoomReset} title="Reset zoom">⊙</button>
            <button className="btn btn-xs btn-ghost" onClick={zoomIn} title="Zoom in">+</button>
            <button className="btn btn-xs btn-ghost" onClick={zoomToFit} title="Zoom to fit">⊞</button>
          </div>
          <div className="mindmap-filter-group">
            {Object.entries({ projects: 'project', plugins: 'plugin', skills: 'skill', agents: 'agent' }).map(([key, type]) => (
              <button
                key={key}
                className={`mindmap-filter-btn ${filters[key] ? 'active' : ''}`}
                onClick={() => toggleFilter(key)}
                style={{ '--filter-color': NODE_COLORS[type] }}
              >
                <span className="mindmap-filter-dot" style={{ background: filters[key] ? NODE_COLORS[type] : 'transparent', borderColor: NODE_COLORS[type] }} />
                {key.charAt(0).toUpperCase() + key.slice(1)}
                {typeCounts[type] > 0 && <span className="mindmap-filter-count">{typeCounts[type]}</span>}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mindmap-container" ref={containerRef}>
        <div className="mindmap-search">
          <svg className="mindmap-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input"
          />
        </div>

        {linkMode && (
          <div className="mindmap-link-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            {linkSource
              ? `Click a skill or agent to link with "${linkSource.name}"`
              : 'Click a project to start linking'}
          </div>
        )}

        <svg ref={svgRef} />

        {/* Empty state */}
        {!loading && graphData.nodes.length === 0 && (
          <div className="mindmap-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="1.5"><circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/></svg>
            <p>No nodes yet</p>
            <p className="mindmap-empty-hint">Right-click to create an agent or skill</p>
          </div>
        )}

        {/* Legend */}
        <div className="mindmap-legend">
          {Object.entries(NODE_COLORS).map(([type, color]) => (
            <span key={type} className="mindmap-legend-item">
              <span className="mindmap-legend-dot" style={{ background: color }} />
              {type.charAt(0).toUpperCase() + type.slice(1)}s
              <span className="mindmap-legend-count">{typeCounts[type] || 0}</span>
            </span>
          ))}
        </div>

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="mindmap-context-menu"
            style={{
              left: Math.min(contextMenu.x, window.innerWidth - 200),
              top: Math.min(contextMenu.y, window.innerHeight - 280),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.node ? (
              <>
                <div className="mindmap-ctx-header">
                  <span className="mindmap-ctx-dot" style={{ background: NODE_COLORS[contextMenu.node.type] }} />
                  <span className="mindmap-ctx-name">{contextMenu.node.name}</span>
                  <span className={`mindmap-ctx-tag mindmap-type-${contextMenu.node.type}`}>
                    {contextMenu.node.type}
                  </span>
                </div>
                <div className="mindmap-ctx-divider" />
                <button className="mindmap-ctx-item" onClick={() => { setSelectedNode(contextMenu.node); setContextMenu(null); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  View Details
                </button>
                {contextMenu.node.type === 'project' && (
                  <>
                    <button className="mindmap-ctx-item" onClick={() => { openAgentPickerForProject(contextMenu.node, contextMenu.x, contextMenu.y); setContextMenu(null); }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                      Add Existing Agent
                    </button>
                    <button className="mindmap-ctx-item" onClick={() => { setLinkMode(true); setLinkSource(contextMenu.node); setContextMenu(null); }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      Link to Skill/Agent
                    </button>
                  </>
                )}
                {contextMenu.node.type === 'agent' && contextMenu.node.scope === 'global' && (
                  <>
                    <div className="mindmap-ctx-divider" />
                    <button className="mindmap-ctx-item" onClick={() => { handleDeactivateAgent(contextMenu.node.name); setContextMenu(null); }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      Hide from Mindmap
                    </button>
                    <button className="mindmap-ctx-item mindmap-ctx-danger" onClick={() => handleDeleteAgent(contextMenu.node.name)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      Delete Agent
                    </button>
                  </>
                )}
                {contextMenu.node.type === 'skill' && contextMenu.node.scope === 'user' && (
                  <>
                    <div className="mindmap-ctx-divider" />
                    <button className="mindmap-ctx-item mindmap-ctx-danger" onClick={() => handleDeleteSkill(contextMenu.node.id || contextMenu.node.name)}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      Delete Skill
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="mindmap-ctx-section-label">Create</div>
                <button className="mindmap-ctx-item" onClick={() => { setModal('addAgent'); setModalData({}); setAddAgentTab('existing'); fetchAllAgents(); setContextMenu(null); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                  Manage Agents
                </button>
                <button className="mindmap-ctx-item" onClick={() => { setModal('skill'); setModalData({}); setContextMenu(null); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                  New Skill
                </button>
                <div className="mindmap-ctx-divider" />
                <div className="mindmap-ctx-section-label">View</div>
                <button className="mindmap-ctx-item" onClick={() => { zoomToFit(); setContextMenu(null); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                  Zoom to Fit
                </button>
                <button className="mindmap-ctx-item" onClick={() => { zoomReset(); setContextMenu(null); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                  Reset View
                </button>
              </>
            )}
          </div>
        )}

        {/* Agent Picker for Project */}
        {ctxAgentPicker && (
          <div
            className="mindmap-context-menu mindmap-agent-picker"
            style={{
              left: Math.min(ctxAgentPicker.x, window.innerWidth - 240),
              top: Math.min(ctxAgentPicker.y, window.innerHeight - 300),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mindmap-ctx-header">
              <span className="mindmap-ctx-dot" style={{ background: NODE_COLORS.project }} />
              <span className="mindmap-ctx-name">{ctxAgentPicker.projectNode.name}</span>
            </div>
            <div className="mindmap-ctx-section-label">Add agent to project</div>
            <div className="mindmap-ctx-divider" />
            {ctxAgentPicker.loading ? (
              <div className="mindmap-ctx-item" style={{ opacity: 0.5, cursor: 'default' }}>Loading...</div>
            ) : ctxAgentPicker.agents.length === 0 ? (
              <div className="mindmap-ctx-item" style={{ opacity: 0.5, cursor: 'default' }}>No available agents</div>
            ) : (
              ctxAgentPicker.agents.map((agent) => (
                <button
                  key={agent.name}
                  className="mindmap-ctx-item"
                  onClick={() => handlePickAgentForProject(ctxAgentPicker.projectNode, agent.name)}
                >
                  <span className="mindmap-ctx-dot" style={{ background: NODE_COLORS.agent }} />
                  {agent.name}
                </button>
              ))
            )}
          </div>
        )}

        {/* Side Panel */}
        {selectedNode && (
          <div className="mindmap-panel">
            <div className="mindmap-panel-header">
              <span className={`mindmap-type-badge mindmap-type-${selectedNode.type}`}>
                {selectedNode.type}
              </span>
              <button className="mindmap-panel-close" onClick={() => setSelectedNode(null)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <h3 className="mindmap-panel-name">{selectedNode.name}</h3>

            {/* Agent edit mode */}
            {selectedNode.type === 'agent' && selectedNode.scope === 'global' && editingAgent ? (
              <>
                <div className="mindmap-panel-edit-section">
                  <label className="mindmap-panel-edit-label">Description</label>
                  <textarea
                    className="mindmap-panel-edit-input"
                    rows={3}
                    value={editingAgent.description}
                    onChange={(e) => setEditingAgent({ ...editingAgent, description: e.target.value })}
                    placeholder="When to use this agent..."
                  />
                </div>
                <div className="mindmap-panel-edit-section">
                  <label className="mindmap-panel-edit-label">Model</label>
                  <select
                    className="mindmap-panel-edit-input"
                    value={editingAgent.model}
                    onChange={(e) => setEditingAgent({ ...editingAgent, model: e.target.value })}
                  >
                    <option value="">Default</option>
                    <option value="opus">Opus</option>
                    <option value="sonnet">Sonnet</option>
                    <option value="haiku">Haiku</option>
                  </select>
                </div>
                <div className="mindmap-panel-edit-section">
                  <label className="mindmap-panel-edit-label">System Prompt</label>
                  <textarea
                    className="mindmap-panel-edit-input mindmap-panel-edit-prompt"
                    rows={16}
                    value={editingAgent.prompt}
                    onChange={(e) => setEditingAgent({ ...editingAgent, prompt: e.target.value })}
                    placeholder="Agent instructions in Markdown..."
                  />
                </div>
                <div className="mindmap-panel-actions">
                  <button className="btn btn-sm btn-ghost" onClick={() => setEditingAgent(null)}>Cancel</button>
                  <button className="btn btn-sm btn-primary" onClick={() => handleSaveAgent(selectedNode.name)} disabled={agentSaving}>
                    {agentSaving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Read-only view */}
                {selectedNode.description && (
                  <div className="mindmap-panel-desc-section">
                    <h4>Description</h4>
                    <p className="mindmap-panel-desc">{selectedNode.description}</p>
                  </div>
                )}

                <div className="mindmap-panel-meta-group">
                  {selectedNode.scope && (
                    <span className="mindmap-panel-meta">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                      {selectedNode.scope}
                    </span>
                  )}
                  {selectedNode.isMcp && (
                    <span className="mindmap-panel-meta mindmap-mcp-badge">MCP Server</span>
                  )}
                  {selectedNode.model && (
                    <span className="mindmap-panel-meta">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                      {selectedNode.model}
                    </span>
                  )}
                  {selectedNode.plugin && (
                    <span className="mindmap-panel-meta">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                      {selectedNode.plugin}
                    </span>
                  )}
                  {selectedNode.hasClaude && (
                    <span className="mindmap-panel-meta mindmap-claude-badge">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/></svg>
                      CLAUDE.md
                    </span>
                  )}
                </div>

                {selectedNode.prompt && (
                  <div className="mindmap-panel-prompt">
                    <h4>System Prompt</h4>
                    <pre className="mindmap-panel-prompt-content">{selectedNode.prompt}</pre>
                  </div>
                )}

                {/* Actions */}
                <div className="mindmap-panel-actions">
                  {selectedNode.type === 'project' && (
                    <button className="btn btn-sm btn-ghost" onClick={() => { setLinkMode(true); setLinkSource(selectedNode); setSelectedNode(null); }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      Link to...
                    </button>
                  )}
                  {selectedNode.type === 'agent' && selectedNode.scope === 'global' && (
                    <>
                      <button className="btn btn-sm btn-ghost" onClick={() => handleStartEditAgent(selectedNode)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        Edit
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => handleDeactivateAgent(selectedNode.name)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        Hide
                      </button>
                      <button className="btn btn-sm btn-ghost mindmap-panel-delete-btn" onClick={() => handleDeleteAgent(selectedNode.name)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        Delete
                      </button>
                    </>
                  )}
              {selectedNode.type === 'skill' && selectedNode.scope === 'user' && (
                <button className="btn btn-sm btn-ghost mindmap-panel-delete-btn" onClick={() => handleDeleteSkill(selectedNode.id || selectedNode.name)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Delete
                </button>
              )}
            </div>

            <div className="mindmap-panel-connections">
              <h4>Connections ({getConnections(selectedNode).length})</h4>
              {getConnections(selectedNode).length === 0 ? (
                <p className="mindmap-panel-empty">No connections yet</p>
              ) : (
                getConnections(selectedNode).map((conn) => (
                  <div key={conn.id} className="mindmap-connection-item">
                    <span className="mindmap-conn-dot" style={{ background: NODE_COLORS[conn.type] }} />
                    <span className="mindmap-connection-name">{conn.name}</span>
                    <span className="mindmap-link-type-label">{conn.linkType}</span>
                    {conn.linkType === 'manual' && (
                      <button
                        className="btn btn-xs btn-ghost mindmap-unlink-btn"
                        onClick={() => handleUnlink(conn.linkSource, conn.linkTarget)}
                      >
                        Unlink
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Add Agent Modal (tabbed: Existing / Create New) */}
      {modal === 'addAgent' && (
        <div className="mindmap-modal-overlay" onClick={() => setModal(null)}>
          <div className="mindmap-modal mindmap-modal-agent" onClick={(e) => e.stopPropagation()}>
            <div className="mindmap-modal-icon-header mindmap-modal-icon-agent">
              <div className="mindmap-modal-icon-circle">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </div>
              <div className="mindmap-modal-icon-text">
                <h3>Manage Agents</h3>
                <p>Activate, deactivate, or create agents</p>
              </div>
              <button className="mindmap-modal-close" onClick={() => setModal(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="mindmap-modal-tabs">
              <button
                className={`mindmap-modal-tab ${addAgentTab === 'existing' ? 'active' : ''}`}
                onClick={() => setAddAgentTab('existing')}
              >
                Existing
              </button>
              <button
                className={`mindmap-modal-tab ${addAgentTab === 'create' ? 'active' : ''}`}
                onClick={() => setAddAgentTab('create')}
              >
                Create New
              </button>
            </div>

            {addAgentTab === 'existing' ? (
              <div className="mindmap-modal-body">
                {agentsLoading ? (
                  <div className="mindmap-agent-list-empty">Loading agents...</div>
                ) : allAgents.length === 0 ? (
                  <div className="mindmap-agent-list-empty">
                    <p>No agents found.</p>
                    <button className="btn btn-sm btn-ghost" onClick={() => setAddAgentTab('create')}>
                      Create your first agent
                    </button>
                  </div>
                ) : (
                  <div className="mindmap-agent-list">
                    {allAgents.map((agent) => (
                      <div key={agent.name} className={`mindmap-agent-list-item ${agent.active ? 'is-active' : ''}`}>
                        <div className="mindmap-agent-list-info">
                          <span className="mindmap-agent-list-name">{agent.name}</span>
                          {agent.description && <span className="mindmap-agent-list-desc">{agent.description}</span>}
                        </div>
                        <button
                          className={`mindmap-agent-toggle ${agent.active ? 'active' : ''}`}
                          onClick={async () => {
                            if (agent.active) {
                              await handleDeactivateAgent(agent.name);
                            } else {
                              await handleActivateAgent(agent.name);
                            }
                          }}
                        >
                          <span className="mindmap-agent-toggle-track">
                            <span className="mindmap-agent-toggle-thumb" />
                          </span>
                          <span className="mindmap-agent-toggle-label">{agent.active ? 'Active' : 'Inactive'}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="mindmap-modal-body">
                  <div className="form-group">
                    <label>Agent Name <span className="form-required">*</span></label>
                    <input
                      type="text"
                      placeholder="e.g. code-reviewer"
                      value={modalData.name || ''}
                      onChange={(e) => setModalData({ ...modalData, name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() })}
                      autoFocus
                    />
                    {modalData.name && (
                      <span className="form-hint">
                        Stored in <code>~/.claude/agents.json</code> as <code>{modalData.name}</code>
                      </span>
                    )}
                  </div>
                  <div className="form-group">
                    <label>Description</label>
                    <input
                      type="text"
                      placeholder="Short description of what this agent does..."
                      value={modalData.description || ''}
                      onChange={(e) => setModalData({ ...modalData, description: e.target.value })}
                      maxLength={120}
                    />
                    <span className="form-hint form-hint-right">{(modalData.description || '').length}/120</span>
                  </div>
                  <div className="form-group">
                    <div className="mindmap-ai-assist-row">
                      <label>
                        System Prompt
                        <span className="form-label-hint">Optional</span>
                      </label>
                      <button
                        type="button"
                        className={`mindmap-ai-assist-btn${aiLoading ? ' loading' : ''}`}
                        onClick={handleAiAssist}
                        disabled={!modalData.name || aiLoading}
                        title={!modalData.name ? 'Enter an agent name first' : 'Generate a system prompt with AI'}
                      >
                        {aiLoading ? (
                          <>
                            <span className="mindmap-ai-spinner" />
                            Generating...
                          </>
                        ) : (
                          <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 2l1.09 3.26L16 6l-2.91.74L12 10l-1.09-3.26L8 6l2.91-.74L12 2z"/>
                              <path d="M5 15l.54 1.63L7 17.17l-1.46.37L5 19.17l-.54-1.63L3 17.17l1.46-.37L5 15z"/>
                              <path d="M19 11l.54 1.63L21 13.17l-1.46.37L19 15.17l-.54-1.63L17 13.17l1.46-.37L19 11z"/>
                            </svg>
                            Generate with AI
                          </>
                        )}
                      </button>
                    </div>
                    <textarea
                      rows={6}
                      placeholder="Custom instructions for this agent..."
                      value={modalData.prompt || ''}
                      onChange={(e) => setModalData({ ...modalData, prompt: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Model</label>
                    <div className="mindmap-model-grid">
                      {[
                        { value: '', label: 'Default', desc: 'Use system default' },
                        { value: 'claude-opus-4-6', label: 'Opus 4.6', desc: 'Most capable' },
                        { value: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5', desc: 'Balanced' },
                        { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', desc: 'Fastest' },
                      ].map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          className={`mindmap-model-option ${(modalData.model || '') === m.value ? 'active' : ''}`}
                          onClick={() => setModalData({ ...modalData, model: m.value })}
                        >
                          <span className="mindmap-model-label">{m.label}</span>
                          <span className="mindmap-model-desc">{m.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="mindmap-modal-footer">
                  <button className="btn btn-sm btn-ghost" onClick={() => setModal(null)}>Cancel</button>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={handleCreateAgent}
                    disabled={!modalData.name}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Create Agent
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Create Skill Modal */}
      {modal === 'skill' && (
        <div className="mindmap-modal-overlay" onClick={() => setModal(null)}>
          <div className="mindmap-modal mindmap-modal-skill" onClick={(e) => e.stopPropagation()}>
            <div className="mindmap-modal-icon-header mindmap-modal-icon-skill">
              <div className="mindmap-modal-icon-circle">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </div>
              <div className="mindmap-modal-icon-text">
                <h3>Create Skill</h3>
                <p>A reusable SKILL.md file with instructions for Claude</p>
              </div>
              <button className="mindmap-modal-close" onClick={() => setModal(null)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div className="mindmap-modal-body">
              <div className="form-group">
                <label>Skill Name <span className="form-required">*</span></label>
                <input
                  type="text"
                  placeholder="e.g. react-best-practices"
                  value={modalData.name || ''}
                  onChange={(e) => setModalData({ ...modalData, name: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() })}
                  autoFocus
                />
                {modalData.name && (
                  <span className="form-hint">
                    Saved to <code>~/.claude/skills/{modalData.name}/SKILL.md</code>
                  </span>
                )}
              </div>
              <div className="form-group">
                <label>Description</label>
                <input
                  type="text"
                  placeholder="What this skill teaches Claude to do..."
                  value={modalData.description || ''}
                  onChange={(e) => setModalData({ ...modalData, description: e.target.value })}
                  maxLength={120}
                />
                <span className="form-hint form-hint-right">{(modalData.description || '').length}/120</span>
              </div>
              <div className="form-group">
                <label>
                  Instructions
                  <span className="form-label-hint">Markdown</span>
                </label>
                <textarea
                  rows={8}
                  placeholder={"# My Skill\n\nWhen working on this type of task:\n\n1. Always do X\n2. Follow Y pattern\n3. Never forget Z"}
                  value={modalData.content || ''}
                  onChange={(e) => setModalData({ ...modalData, content: e.target.value })}
                />
                <span className="form-hint form-hint-right">{(modalData.content || '').length} chars</span>
              </div>
            </div>
            <div className="mindmap-modal-footer">
              <button className="btn btn-sm btn-ghost" onClick={() => setModal(null)}>Cancel</button>
              <button
                className="btn btn-sm btn-primary"
                onClick={handleCreateSkill}
                disabled={!modalData.name}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Create Skill
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
