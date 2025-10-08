import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { BarChart3, CheckCircle, AlertCircle, TrendingUp } from 'lucide-react';

interface QuestionStatsProps {
  courseId: string;
  questionType: 'MCQ' | 'MSQ' | 'NAT' | 'Subjective';
  totalTarget: number;
}

interface TopicStats {
  topicId: string;
  topicName: string;
  target: number;
  existing: number;
  remaining: number;
  pyqCount: number;
}

export function QuestionStats({ courseId, questionType, totalTarget }: QuestionStatsProps) {
  const [stats, setStats] = useState<TopicStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [totals, setTotals] = useState({ existing: 0, remaining: 0, pyqCount: 0 });

  useEffect(() => {
    if (courseId) {
      loadStats();
    }
  }, [courseId, questionType]);

  const loadStats = async () => {
    setLoading(true);
    try {
      // Get all topics for this course
      const { data: topics, error: topicsError } = await supabase
        .from('topics')
        .select('id, name, weightage, chapters!inner(course_id)')
        .eq('chapters.course_id', courseId)
        .order('weightage', { ascending: false });

      if (topicsError) throw topicsError;

      if (!topics || topics.length === 0) {
        setStats([]);
        return;
      }

      // Calculate target questions per topic
      const topicsWithWeightage = topics.filter(t => (t.weightage || 0) > 0);
      const topicsWithoutWeightage = topics.filter(t => (t.weightage || 0) === 0);
      const totalWeightage = topicsWithWeightage.reduce((sum, t) => sum + (t.weightage || 0.02), 0);
      const shouldGenerateForZeroWeightage = totalTarget >= 500;

      const topicStats: TopicStats[] = [];
      let totalExisting = 0;
      let totalRemaining = 0;
      let totalPYQs = 0;

      for (const topic of topics) {
        const topicWeightage = topic.weightage || 0;
        let target = 0;

        if (topicWeightage === 0) {
          target = shouldGenerateForZeroWeightage ? 1 : 0;
        } else {
          target = Math.max(1, Math.round((topicWeightage / totalWeightage) * totalTarget));
        }

        // Get existing questions count
        const { count: existingCount } = await supabase
          .from('new_questions')
          .select('*', { count: 'exact', head: true })
          .eq('topic_id', topic.id)
          .eq('question_type', questionType);

        // Get PYQ count
        const { count: pyqCount } = await supabase
          .from('questions_topic_wise')
          .select('*', { count: 'exact', head: true })
          .eq('topic_id', topic.id);

        const existing = existingCount || 0;
        const remaining = Math.max(0, target - existing);
        const pyqs = pyqCount || 0;

        totalExisting += existing;
        totalRemaining += remaining;
        totalPYQs += pyqs;

        topicStats.push({
          topicId: topic.id,
          topicName: topic.name,
          target,
          existing,
          remaining,
          pyqCount: pyqs
        });
      }

      setStats(topicStats.filter(s => s.target > 0));
      setTotals({ existing: totalExisting, remaining: totalRemaining, pyqCount: totalPYQs });
    } catch (error) {
      console.error('Error loading question stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600">Loading statistics...</span>
        </div>
      </div>
    );
  }

  if (!courseId || stats.length === 0) {
    return null;
  }

  const completionPercentage = totals.existing > 0 && totalTarget > 0
    ? Math.round((totals.existing / (totals.existing + totals.remaining)) * 100)
    : 0;

  return (
    <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="bg-blue-500 p-2 rounded-lg">
            <BarChart3 className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-800">Question Progress - {questionType}</h3>
            <p className="text-sm text-gray-600">Topic-wise breakdown and statistics</p>
          </div>
        </div>
        <button
          onClick={loadStats}
          className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-all text-sm font-medium"
        >
          Refresh Stats
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-xl border border-blue-200">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="w-5 h-5 text-blue-600" />
            <h4 className="text-sm font-semibold text-blue-800">Completed</h4>
          </div>
          <p className="text-3xl font-bold text-blue-900">{totals.existing}</p>
          <p className="text-xs text-blue-600 mt-1">{completionPercentage}% done</p>
        </div>

        <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 rounded-xl border border-orange-200">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-5 h-5 text-orange-600" />
            <h4 className="text-sm font-semibold text-orange-800">Remaining</h4>
          </div>
          <p className="text-3xl font-bold text-orange-900">{totals.remaining}</p>
          <p className="text-xs text-orange-600 mt-1">to be generated</p>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-xl border border-green-200">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            <h4 className="text-sm font-semibold text-green-800">Target</h4>
          </div>
          <p className="text-3xl font-bold text-green-900">{totals.existing + totals.remaining}</p>
          <p className="text-xs text-green-600 mt-1">total questions</p>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-xl border border-purple-200">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-5 h-5 text-purple-600" />
            <h4 className="text-sm font-semibold text-purple-800">PYQs Available</h4>
          </div>
          <p className="text-3xl font-bold text-purple-900">{totals.pyqCount}</p>
          <p className="text-xs text-purple-600 mt-1">for reference</p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700">Overall Progress</span>
          <span className="text-sm font-semibold text-gray-900">{completionPercentage}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className="bg-gradient-to-r from-blue-500 to-green-500 h-3 rounded-full transition-all duration-500"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>
      </div>

      {/* Topic-wise breakdown */}
      <div className="space-y-3 max-h-96 overflow-y-auto">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">Topic-wise Breakdown (Top 20)</h4>
        {stats.slice(0, 20).map((stat) => (
          <div
            key={stat.topicId}
            className="bg-gray-50 p-4 rounded-lg border border-gray-200 hover:border-blue-300 transition-all"
          >
            <div className="flex items-center justify-between mb-2">
              <h5 className="font-medium text-gray-800 flex-1 truncate">{stat.topicName}</h5>
              <div className="flex items-center gap-4 text-sm">
                <span className="text-green-600 font-semibold">{stat.existing} done</span>
                <span className="text-orange-600 font-semibold">{stat.remaining} left</span>
                <span className="text-purple-600 text-xs">({stat.pyqCount} PYQs)</span>
              </div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-green-400 to-green-600 h-2 rounded-full"
                style={{ width: `${stat.target > 0 ? (stat.existing / stat.target) * 100 : 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1 text-xs text-gray-500">
              <span>Target: {stat.target}</span>
              <span>{stat.target > 0 ? Math.round((stat.existing / stat.target) * 100) : 0}% complete</span>
            </div>
          </div>
        ))}
        {stats.length > 20 && (
          <p className="text-sm text-gray-500 text-center mt-4">
            And {stats.length - 20} more topics...
          </p>
        )}
      </div>
    </div>
  );
}
