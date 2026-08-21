import { useState } from 'react';
import type { RepoSymbol } from '../types';
import { filterByKind } from '../hooks/useSymbols';

interface QuickToursProps {
  repoName: string;
  symbols: RepoSymbol[];
  onTour: (question: string) => void;
}

interface Tour {
  id: string;
  title: string;
  question: string;
}

function deriveTours(repoName: string, symbols: RepoSymbol[]): Tour[] {
  const firstRoute = filterByKind(symbols, 'route')[0];
  if (firstRoute) {
    return [
      {
        id: 'recommended',
        title: `Trace ${firstRoute.name}`,
        question: `${firstRoute.name} 经过了哪些类`
      },
      {
        id: 'arch',
        title: 'Architecture overview',
        question: '这个项目的整体架构是怎样的？请给出模块划分和调用层次'
      },
      {
        id: 'exception',
        title: 'Where are exceptions handled?',
        question: '全局异常处理在哪里实现？'
      }
    ];
  }
  const firstClass = symbols.find((s) => s.kind === 'class');
  if (firstClass) {
    return [
      {
        id: 'recommended',
        title: `Understand ${firstClass.name}`,
        question: `${firstClass.name} 的职责是什么，它调用了哪些类`
      },
      {
        id: 'arch',
        title: 'Architecture overview',
        question: '这个项目的整体架构是怎样的？请给出模块划分和调用层次'
      },
      {
        id: 'exception',
        title: 'Where are exceptions handled?',
        question: '全局异常处理在哪里实现？'
      }
    ];
  }
  return [
    {
      id: 'recommended',
      title: 'Architecture overview',
      question: `请介绍 ${repoName} 项目的整体架构`
    }
  ];
}

/**
 * Quick Tours: one Recommended Flow on first screen; the rest collapse under
 * "More Tours" (review decision: no three-card row).
 */
export function QuickTours({ repoName, symbols, onTour }: QuickToursProps) {
  const [expanded, setExpanded] = useState(false);
  const tours = deriveTours(repoName, symbols);
  const [recommended, ...rest] = tours;

  return (
    <div>
      <button
        type="button"
        data-testid={`tour-${recommended.id}`}
        onClick={() => onTour(recommended.question)}
        className="mb-1 flex w-full items-center justify-between gap-2 rounded-md border border-accent/30 bg-accent-soft/50 px-2.5 py-2 text-left text-xs font-medium text-accent hover:bg-accent-soft"
      >
        <span>{recommended.title}</span>
        <span aria-hidden className="text-accent">→</span>
      </button>

      {rest.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            data-testid="more-tours-toggle"
            onClick={() => setExpanded((v) => !v)}
            className="w-full px-2.5 py-1 text-left text-xs text-slate-400 hover:text-slate-600"
          >
            {expanded ? 'Hide More Tours' : `More Tours (${rest.length})`}
          </button>
          {expanded && (
            <ul className="mt-1 space-y-1">
              {rest.map((tour) => (
                <li key={tour.id}>
                  <button
                    type="button"
                    data-testid={`tour-${tour.id}`}
                    onClick={() => onTour(tour.question)}
                    className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-left text-xs text-slate-600 hover:border-accent/40 hover:text-accent"
                  >
                    {tour.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}