import React, { useState, useCallback } from 'react';
import { AlertTriangle, Trash2, Eye, CheckCircle, XCircle, RefreshCw, Database, Zap, Settings, Play, Pause } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { validateQuestionWithGeminiAI, ExtractedQuestion } from '../lib/gemini';
import { QuestionPreview } from './QuestionPreview';
import toast, { Toaster } from 'react-hot-toast';

interface Exam {
  id: string;
  name: string;
}

interface Course {
  id: string;
  name: string;
  exam_id: string;
}

interface QuestionToValidate {
  id: string;
  topic_id: string;
  topic_name: string;
  question_statement: string;
  question_type: 'MCQ' | 'MSQ' | 'NAT' | 'Subjective';
  options: string[] | null;
  answer: string | null;
  solution: string | null;
  created_at: string;
  is_wrong: boolean | null;
}

interface ValidationProgress {
  currentQuestion: number;
  totalQuestions: number;
  questionsValidated: number;
  questionsMarkedWrong: number;
  questionsMarkedCorrect: number;
  isValidating: boolean;
  isPaused: boolean;
  currentQuestionText: string;
}

export function WrongQuestionRemover() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedExam, setSelectedExam] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [wrongQuestions, setWrongQuestions] = useState<QuestionToValidate[]>([]);
  const [correctQuestions, setCorrectQuestions] = useState<QuestionToValidate[]>([]);
  const [totalQuestions, setTotalQuestions] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  
  const [progress, setProgress] = useState<ValidationProgress>({
    currentQuestion: 0,
    totalQuestions: 0,
    questionsValidated: 0,
    questionsMarkedWrong: 0,
    questionsMarkedCorrect: 0,
    isValidating: false,
    isPaused: false,
    currentQuestionText: ''
  });

  React.useEffect(() => {
    loadExams();
  }, []);

  React.useEffect(() => {
    if (selectedExam) {
      loadCourses(selectedExam);
    }
  }, [selectedExam]);

  const loadExams = async () => {
    try {
      const { data, error } = await supabase
        .from('exams')
        .select('id, name')
        .order('name');
      
      if (error) throw error;
      setExams(data || []);
    } catch (error) {
      toast.error('Failed to load exams');
      console.error('Error loading exams:', error);
    }
  };

  const loadCourses = async (examId: string) => {
    try {
      const { data, error } = await supabase
        .from('courses')
        .select('id, name, exam_id')
        .eq('exam_id', examId)
        .order('name');
      
      if (error) throw error;
      setCourses(data || []);
    } catch (error) {
      toast.error('Failed to load courses');
      console.error('Error loading courses:', error);
    }
  };

  const loadQuestionsCount = async () => {
    if (!selectedCourse) return;

    try {
      // First get all topic IDs for the selected course
      const { data: topics, error: topicsError } = await supabase
        .from('topics')
        .select('id, chapters(course_id)')
        .eq('chapters.course_id', selectedCourse);
      
      if (topicsError) throw topicsError;
      
      if (!topics || topics.length === 0) {
        setTotalQuestions(0);
        return;
      }
      
      const topicIds = topics.map(topic => topic.id);
      
      // Then count questions for these topics
      const { count, error } = await supabase
        .from('new_questions')
        .select('*', { count: 'exact', head: true })
        .in('topic_id', topicIds);
      
      if (error) throw error;
      setTotalQuestions(count || 0);
    } catch (error) {
      console.error('Error loading questions count:', error);
      setTotalQuestions(0);
    }
  };

  React.useEffect(() => {
    if (selectedCourse) {
      loadQuestionsCount();
    }
  }, [selectedCourse]);

  const startValidation = async () => {
    if (!selectedCourse) {
      toast.error('Please select a course first');
      return;
    }

    setProgress({
      currentQuestion: 0,
      totalQuestions: 0,
      questionsValidated: 0,
      questionsMarkedWrong: 0,
      questionsMarkedCorrect: 0,
      isValidating: true,
      isPaused: false,
      currentQuestionText: ''
    });

    setWrongQuestions([]);
    setCorrectQuestions([]);

    try {
      // First get all topic IDs for the selected course
      const { data: topics, error: topicsError } = await supabase
        .from('topics')
        .select('id, name, chapters!inner(course_id)')
        .eq('chapters.course_id', selectedCourse);
      
      if (topicsError) throw topicsError;
      
      if (!topics || topics.length === 0) {
        toast.success('No topics found for this course');
        setProgress(prev => ({ ...prev, isValidating: false }));
        return;
      }
      
      const topicIds = topics.map(topic => topic.id);
      
      // Then get all questions for these topics
      const { data: questions, error } = await supabase
        .from('new_questions')
        .select('*')
        .in('topic_id', topicIds);

      if (error) throw error;

      if (!questions || questions.length === 0) {
        toast.success('No questions found for validation');
        setProgress(prev => ({ ...prev, isValidating: false }));
        return;
      }

      setProgress(prev => ({ ...prev, totalQuestions: questions.length }));
      
      const wrongQuestionsFound: QuestionToValidate[] = [];
      const correctQuestionsFound: QuestionToValidate[] = [];
      let questionsMarkedWrong = 0;
      let questionsMarkedCorrect = 0;

      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];

        // Check if validation is paused
        while (progress.isPaused) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Check if validation was stopped
        if (!progress.isValidating) {
          break;
        }

        setProgress(prev => ({
          ...prev,
          currentQuestion: i + 1,
          questionsValidated: i + 1,
          currentQuestionText: question.question_statement.substring(0, 100) + '...'
        }));

        try {
          toast(`🤖 Gemini validating ${question.question_type} question ${i + 1}/${questions.length}...`, { duration: 2000 });
          
          // Use comprehensive Gemini AI validation
          const validation = await validateQuestionWithGeminiAI(question);
          
          // Update the is_wrong column in database
          const { error: updateError } = await supabase
            .from('new_questions')
            .update({ is_wrong: validation.isWrong })
            .eq('id', question.id);

          if (updateError) {
            console.error('Error updating question:', updateError);
            toast.error(`Failed to update question ${i + 1}`);
          } else {
            if (validation.isWrong) {
              questionsMarkedWrong++;
              wrongQuestionsFound.push({
                ...question,
                is_wrong: true
              });
              toast.error(`❌ Question ${i + 1} marked as WRONG: ${validation.reason}`);
            } else {
              questionsMarkedCorrect++;
              correctQuestionsFound.push({
                ...question,
                is_wrong: false
              });
              toast.success(`✅ Question ${i + 1} marked as CORRECT`);
            }
          }

          setProgress(prev => ({
            ...prev,
            questionsMarkedWrong,
            questionsMarkedCorrect
          }));

          // Add delay between AI calls to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 8000));

        } catch (error) {
          console.error(`Error validating question ${i + 1}:`, error);
          toast.error(`Failed to validate question ${i + 1}: ${error.message}`);
          
          // Add longer delay on error
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      setWrongQuestions(wrongQuestionsFound);
      setCorrectQuestions(correctQuestionsFound);
      
      toast.success(`🎉 Validation complete! Marked ${questionsMarkedWrong} questions as WRONG and ${questionsMarkedCorrect} as CORRECT out of ${questions.length} total questions.`);

    } catch (error) {
      console.error('Validation error:', error);
      toast.error(`Validation failed: ${error.message}`);
    } finally {
      setProgress(prev => ({ ...prev, isValidating: false, isPaused: false }));
    }
  };

  const pauseValidation = () => {
    setProgress(prev => ({ ...prev, isPaused: !prev.isPaused }));
    toast(progress.isPaused ? '▶️ Validation resumed' : '⏸️ Validation paused');
  };

  const stopValidation = () => {
    setProgress(prev => ({ ...prev, isValidating: false, isPaused: false }));
    toast('🛑 Validation stopped');
  };

  const deleteWrongQuestions = async () => {
    if (wrongQuestions.length === 0) {
      toast.error('No wrong questions to delete');
      return;
    }

    try {
      const questionIds = wrongQuestions.map(q => q.id);
      
      const { error } = await supabase
        .from('new_questions')
        .delete()
        .in('id', questionIds);

      if (error) throw error;

      toast.success(`🎉 Deleted all ${wrongQuestions.length} wrong questions!`);
      setWrongQuestions([]);
      
      // Reload question count
      loadQuestionsCount();
    } catch (error) {
      console.error('Error deleting questions:', error);
      toast.error('Failed to delete wrong questions');
    }
  };

  const loadValidatedQuestions = async () => {
    if (!selectedCourse) {
      toast.error('Please select a course first');
      return;
    }

    setIsLoading(true);
    try {
      // Get all topic IDs for the selected course
      const { data: topics, error: topicsError } = await supabase
        .from('topics')
        .select('id, name, chapters!inner(course_id)')
        .eq('chapters.course_id', selectedCourse);
      
      if (topicsError) throw topicsError;
      
      if (!topics || topics.length === 0) {
        toast.error('No topics found for this course');
        return;
      }
      
      const topicIds = topics.map(topic => topic.id);
      
      // Get wrong questions
      const { data: wrongQs, error: wrongError } = await supabase
        .from('new_questions')
        .select('*')
        .in('topic_id', topicIds)
        .eq('is_wrong', true);

      if (wrongError) throw wrongError;

      // Get correct questions (limit to 50 for display)
      const { data: correctQs, error: correctError } = await supabase
        .from('new_questions')
        .select('*')
        .in('topic_id', topicIds)
        .eq('is_wrong', false)
        .limit(50);

      if (correctError) throw correctError;

      setWrongQuestions(wrongQs || []);
      setCorrectQuestions(correctQs || []);
      
      toast.success(`Loaded ${wrongQs?.length || 0} wrong questions and ${correctQs?.length || 0} correct questions`);

    } catch (error) {
      console.error('Error loading validated questions:', error);
      toast.error('Failed to load validated questions');
    } finally {
      setIsLoading(false);
    }
  };

  const canStartValidation = selectedCourse && !progress.isValidating;

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50">
      <Toaster position="top-right" />
      
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-gradient-to-r from-red-600 to-orange-600 p-4 rounded-2xl shadow-lg">
              <AlertTriangle className="w-12 h-12 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-red-600 to-orange-600 bg-clip-text text-transparent mb-4">
            AI Question Validator
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Validate questions using comprehensive AI analysis and mark them as correct or wrong in the database
          </p>
          
          {/* Features */}
          <div className="flex items-center justify-center gap-8 mt-8 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <span>Gemini AI Validation</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-orange-500" />
              <span>Round-Robin API Keys</span>
            </div>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-blue-500" />
              <span>is_wrong Column Update</span>
            </div>
          </div>
        </div>

        {/* Configuration Form */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            {/* Exam Selection */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                <Database className="w-4 h-4" />
                Select Exam
              </label>
              <select
                value={selectedExam}
                onChange={(e) => setSelectedExam(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
              >
                <option value="">Choose an exam...</option>
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Course Selection */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                <Database className="w-4 h-4" />
                Select Course
              </label>
              <select
                value={selectedCourse}
                onChange={(e) => setSelectedCourse(e.target.value)}
                disabled={!selectedExam}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all disabled:bg-gray-50"
              >
                <option value="">Choose a course...</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Course Statistics */}
          {selectedCourse && totalQuestions > 0 && (
            <div className="border-t border-gray-200 pt-6">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                <h3 className="text-lg font-semibold text-blue-800 mb-2">Course Statistics</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-blue-600" />
                    <span className="text-blue-700">Total Questions: <strong>{totalQuestions}</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-blue-600" />
                    <span className="text-blue-700">DeepSeek Validation: <strong>Comprehensive</strong></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-blue-600" />
                    <span className="text-blue-700">Updates: <strong>is_wrong column</strong></span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Validation Controls */}
        <div className="flex gap-4 justify-center mb-8">
          {!progress.isValidating ? (
            <div className="flex gap-4">
              <button
                onClick={startValidation}
                disabled={!canStartValidation}
                className="flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-red-600 to-orange-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                <Play className="w-5 h-5" />
                🚀 Start AI Validation
              </button>
              
              <button
                onClick={loadValidatedQuestions}
                disabled={!selectedCourse || isLoading}
                className="flex items-center gap-3 px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                <Eye className="w-5 h-5" />
                {isLoading ? 'Loading...' : 'Load Validated Questions'}
              </button>
            </div>
          ) : (
            <div className="flex gap-4">
              <button
                onClick={pauseValidation}
                className="flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all"
              >
                {progress.isPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                {progress.isPaused ? 'Resume' : 'Pause'}
              </button>
              
              <button
                onClick={stopValidation}
                className="flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all"
              >
                Stop Validation
              </button>
            </div>
          )}
        </div>

        {/* Progress Indicator */}
        {progress.isValidating && (
          <div className="bg-white rounded-2xl shadow-xl p-6 mb-8">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-medium text-red-900">
                  🤖 Gemini Validating Questions
                  {progress.isPaused && ' (Paused)'}
                </h3>
                <span className="text-sm font-medium text-red-700">
                  {progress.currentQuestion}/{progress.totalQuestions}
                </span>
              </div>
              <p className="text-sm text-red-600 mb-3">
                📝 Current: {progress.currentQuestionText}
              </p>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-3 mb-4">
              <div
                className="bg-gradient-to-r from-red-600 to-orange-600 h-3 rounded-full transition-all duration-300"
                style={{
                  width: `${(progress.currentQuestion / progress.totalQuestions) * 100}%`
                }}
              />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-green-700">Validated: {progress.questionsValidated}</span>
              </div>
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-600" />
                <span className="text-red-700">Marked Wrong: {progress.questionsMarkedWrong}</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-blue-600" />
                <span className="text-blue-700">Marked Correct: {progress.questionsMarkedCorrect}</span>
              </div>
            </div>
          </div>
        )}

        {/* Results Summary */}
        {!progress.isValidating && (wrongQuestions.length > 0 || correctQuestions.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div className="bg-gradient-to-r from-red-50 to-red-100 rounded-2xl p-6 border border-red-200">
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-red-500 p-2 rounded-lg">
                  <XCircle className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-red-800">Wrong Questions</h3>
              </div>
              <p className="text-3xl font-bold text-red-900">{wrongQuestions.length}</p>
              <p className="text-sm text-red-600 mt-1">Marked as is_wrong = true</p>
              {wrongQuestions.length > 0 && (
                <button
                  onClick={deleteWrongQuestions}
                  className="mt-4 flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete All Wrong Questions
                </button>
              )}
            </div>
            
            <div className="bg-gradient-to-r from-green-50 to-green-100 rounded-2xl p-6 border border-green-200">
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-green-500 p-2 rounded-lg">
                  <CheckCircle className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-green-800">Correct Questions</h3>
              </div>
              <p className="text-3xl font-bold text-green-900">{correctQuestions.length}</p>
              <p className="text-sm text-green-600 mt-1">Marked as is_wrong = false</p>
            </div>
          </div>
        )}

        {/* Wrong Questions Display */}
        {wrongQuestions.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-red-800">
                ❌ Wrong Questions ({wrongQuestions.length})
              </h2>
            </div>
            
            <div className="space-y-6">
              {wrongQuestions.slice(0, 10).map((question, index) => (
                <div key={question.id} className="border border-red-200 rounded-xl p-6 bg-red-50">
                  {/* Error Info */}
                  <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="w-5 h-5 text-red-600" />
                      <span className="font-semibold text-red-800">Marked as Wrong in Database</span>
                    </div>
                    <p className="text-red-700">This question has been marked as is_wrong = true</p>
                  </div>

                  {/* Question Preview */}
                  <QuestionPreview
                    question={{
                      question_statement: question.question_statement,
                      question_type: question.question_type,
                      options: question.options,
                      page_number: 1,
                      answer: question.answer,
                      solution: question.solution
                    } as ExtractedQuestion}
                    index={index + 1}
                    showControls={false}
                  />
                </div>
              ))}
              
              {wrongQuestions.length > 10 && (
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <p className="text-gray-600">
                    Showing first 10 wrong questions. Total: {wrongQuestions.length}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Correct Questions Sample Display */}
        {correctQuestions.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-green-800">
                ✅ Sample Correct Questions (showing {Math.min(correctQuestions.length, 5)})
              </h2>
            </div>
            
            <div className="space-y-6">
              {correctQuestions.slice(0, 5).map((question, index) => (
                <div key={question.id} className="border border-green-200 rounded-xl p-6 bg-green-50">
                  {/* Success Info */}
                  <div className="mb-4 p-3 bg-green-100 border border-green-300 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <CheckCircle className="w-5 h-5 text-green-600" />
                      <span className="font-semibold text-green-800">Marked as Correct in Database</span>
                    </div>
                    <p className="text-green-700">This question has been marked as is_wrong = false</p>
                  </div>

                  {/* Question Preview */}
                  <QuestionPreview
                    question={{
                      question_statement: question.question_statement,
                      question_type: question.question_type,
                      options: question.options,
                      page_number: 1,
                      answer: question.answer,
                      solution: question.solution
                    } as ExtractedQuestion}
                    index={index + 1}
                    showControls={false}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No Results */}
        {!progress.isValidating && wrongQuestions.length === 0 && correctQuestions.length === 0 && progress.questionsValidated === 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <div className="flex items-center justify-center mb-4">
              <div className="bg-blue-100 p-4 rounded-full">
                <Database className="w-12 h-12 text-blue-600" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-blue-800 mb-2">
              Ready to Validate Questions
            </h2>
            <p className="text-blue-600">
              Select a course and start AI validation to analyze all questions and update the is_wrong column.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}