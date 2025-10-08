import React, { useState, useCallback } from 'react';
import { Brain, BookOpen, Database, Zap, Settings, Play, Pause, CheckCircle, Circle, Hash, CreditCard as Edit3, Target, TrendingUp, Clock, Award, Key } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { generateQuestionsForTopic, generateSolutionsForPYQs, validateQuestionAnswer, ExtractedQuestion, setGeminiApiKeys } from '../lib/gemini';
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

interface Topic {
  id: string;
  name: string;
  chapter_id: string;
  weightage: number;
  notes: string;
  is_notes_done: boolean;
  is_short_notes_done: boolean;
  is_mcq_done: boolean;
  is_msq_done: boolean;
  is_nat_done: boolean;
  is_sub_done: boolean;
}

interface PYQ {
  id: string;
  topic_id: string;
  topic_name: string;
  question_statement: string;
  options: string[];
  answer: string;
  solution: string;
  question_type: string;
  year: number;
  slot: string;
  part: string;
}

interface QuestionTypeConfig {
  type: 'MCQ' | 'MSQ' | 'NAT' | 'Subjective';
  correct_marks: number;
  incorrect_marks: number;
  skipped_marks: number;
  partial_marks: number;
  time_minutes: number;
}

interface GenerationProgress {
  currentTopic: string;
  currentTopicIndex: number;
  totalTopics: number;
  currentQuestionInTopic: number;
  totalQuestionsInTopic: number;
  totalQuestionsGenerated: number;
  totalQuestionsTarget: number;
  isGenerating: boolean;
  isPaused: boolean;
  stage: 'questions' | 'solutions' | 'pyq_solutions';
}

export function QuestionGenerator() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [slots, setSlots] = useState<{id: string, slot_name: string}[]>([]);
  const [parts, setParts] = useState<{id: string, part_name: string}[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  
  const [selectedExam, setSelectedExam] = useState<string>('');
  const [selectedCourse, setSelectedCourse] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [selectedPart, setSelectedPart] = useState<string>('');
  
  // Gemini API Keys - Dynamic array
  const [apiKeys, setApiKeys] = useState<string[]>(['', '', '']);

  const [generationMode, setGenerationMode] = useState<'new_questions' | 'pyq_solutions'>('new_questions');
  const [questionType, setQuestionType] = useState<'MCQ' | 'MSQ' | 'NAT' | 'Subjective'>('MCQ');
  const [totalQuestions, setTotalQuestions] = useState<number>(30);
  
  const [questionConfig, setQuestionConfig] = useState<QuestionTypeConfig>({
    type: 'MCQ',
    correct_marks: 4,
    incorrect_marks: -1,
    skipped_marks: 0,
    partial_marks: 0,
    time_minutes: 3
  });
  
  const [progress, setProgress] = useState<GenerationProgress>({
    currentTopic: '',
    currentTopicIndex: 0,
    totalTopics: 0,
    currentQuestionInTopic: 0,
    totalQuestionsInTopic: 0,
    totalQuestionsGenerated: 0,
    totalQuestionsTarget: 0,
    isGenerating: false,
    isPaused: false,
    stage: 'questions'
  });
  
  const [recentQuestions, setRecentQuestions] = useState<ExtractedQuestion[]>([]);
  const [generatedCount, setGeneratedCount] = useState({ new: 0, pyq: 0 });

  React.useEffect(() => {
    loadExams();
  }, []);

  React.useEffect(() => {
    if (selectedExam) {
      loadCourses(selectedExam);
    }
  }, [selectedExam]);

  React.useEffect(() => {
    if (selectedCourse) {
      loadSlotsAndParts(selectedCourse);
      loadTopics(selectedCourse);
    }
  }, [selectedCourse]);

  React.useEffect(() => {
    setQuestionConfig(prev => ({ ...prev, type: questionType }));
  }, [questionType]);

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

  const loadSlotsAndParts = async (courseId: string) => {
    try {
      // Load slots
      const { data: slotsData, error: slotsError } = await supabase
        .from('slots')
        .select('id, slot_name')
        .eq('course_id', courseId)
        .order('slot_name');
      
      if (slotsError) throw slotsError;
      setSlots(slotsData || []);

      // Load parts
      const { data: partsData, error: partsError } = await supabase
        .from('parts')
        .select('id, part_name')
        .eq('course_id', courseId)
        .order('part_name');
      
      if (partsError) throw partsError;
      setParts(partsData || []);
    } catch (error) {
      toast.error('Failed to load slots and parts');
      console.error('Error loading slots and parts:', error);
    }
  };

  const loadTopics = async (courseId: string) => {
    try {
      const { data, error } = await supabase
        .from('topics')
        .select(`
          id, name, chapter_id, weightage, notes,
          is_notes_done, is_short_notes_done, is_mcq_done, is_msq_done, is_nat_done, is_sub_done,
          chapters!inner(course_id)
        `)
        .eq('chapters.course_id', courseId)
        .order('weightage', { ascending: false });
      
      if (error) throw error;
      setTopics(data || []);
    } catch (error) {
      toast.error('Failed to load topics');
      console.error('Error loading topics:', error);
    }
  };

  const calculateTopicQuestions = (topics: Topic[], totalQuestions: number) => {
    // Separate topics with and without weightage
    const topicsWithWeightage = topics.filter(topic => (topic.weightage || 0) > 0);
    const topicsWithoutWeightage = topics.filter(topic => (topic.weightage || 0) === 0);

    const totalWeightage = topicsWithWeightage.reduce((sum, topic) => sum + (topic.weightage || 0.02), 0);

    // For 500+ questions, generate extra questions for zero-weightage topics
    const shouldGenerateForZeroWeightage = totalQuestions >= 500;
    const extraQuestionsCount = shouldGenerateForZeroWeightage ? topicsWithoutWeightage.length : 0;
    
    const result = topics.map(topic => {
      const topicWeightage = topic.weightage || 0;
      
      if (topicWeightage === 0) {
        // Zero weightage topics get 1 question if total >= 1000, otherwise 0
        const questionsForTopic = shouldGenerateForZeroWeightage ? 1 : 0;
        return {
          ...topic,
          questionsToGenerate: questionsForTopic
        };
      } else {
        // Topics with weightage get distributed questions
        const questionsForTopic = Math.max(1, Math.round((topicWeightage / totalWeightage) * totalQuestions));
        return {
          ...topic,
          questionsToGenerate: questionsForTopic
        };
      }
    });
    
    return {
      topics: result,
      totalQuestionsToGenerate: totalQuestions + extraQuestionsCount,
      extraQuestionsCount
    };
  };

  const getValidApiKeys = () => {
    return apiKeys.filter(key => key.trim() !== '');
  };

  const addApiKey = () => {
    if (apiKeys.length < 100) {
      setApiKeys([...apiKeys, '']);
    }
  };

  const removeApiKey = (index: number) => {
    if (apiKeys.length > 1) {
      const newKeys = apiKeys.filter((_, i) => i !== index);
      setApiKeys(newKeys);
    }
  };

  const updateApiKey = (index: number, value: string) => {
    const newKeys = [...apiKeys];
    newKeys[index] = value;
    setApiKeys(newKeys);
  };

  const handleBulkApiKeyPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    const pastedText = event.clipboardData.getData('text');

    // Extract all API keys that start with AIzaSy
    const keyPattern = /AIzaSy[a-zA-Z0-9_-]+/g;
    const extractedKeys = pastedText.match(keyPattern) || [];

    if (extractedKeys.length === 0) {
      toast.error('No valid API keys found. Keys must start with AIzaSy');
      return;
    }

    // Limit to 100 keys
    const keysToAdd = extractedKeys.slice(0, 100);

    // Remove duplicates
    const uniqueKeys = Array.from(new Set(keysToAdd));

    setApiKeys(uniqueKeys);
    toast.success(`✅ ${uniqueKeys.length} unique API key(s) added!`);
  };

  const startGeneration = async () => {
    console.log('CHECKPOINT: Validating generation prerequisites');

    // Checkpoint 1: Validate exam and course selection
    if (!selectedExam || !selectedCourse) {
      console.error('CHECKPOINT FAILED: Missing exam or course selection');
      toast.error('Please select both exam and course');
      return;
    }

    // Checkpoint 2: Validate topics loaded
    if (topics.length === 0) {
      console.error('CHECKPOINT FAILED: No topics loaded');
      toast.error('No topics found. Please ensure topics exist for this course.');
      return;
    }

    console.log('CHECKPOINT PASSED: Exam and course selected, topics loaded', {
      examId: selectedExam,
      courseId: selectedCourse,
      topicsCount: topics.length
    });

    // Checkpoint 3: Validate API keys
    const validApiKeys = getValidApiKeys();
    if (validApiKeys.length === 0) {
      console.error('CHECKPOINT FAILED: No valid API keys provided');
      toast.error('Please provide at least one Gemini 2.0 Flash API key');
      return;
    }

    console.log('CHECKPOINT PASSED: API keys validated', {
      keysCount: validApiKeys.length
    });

    // Checkpoint 4: Set API keys in the library
    try {
      setGeminiApiKeys(validApiKeys);
      console.log('CHECKPOINT PASSED: API keys set in Gemini library');
      toast.success(`✅ Using ${validApiKeys.length} API key${validApiKeys.length > 1 ? 's' : ''} for generation`);
    } catch (error) {
      console.error('CHECKPOINT FAILED: Failed to set API keys', error);
      toast.error(`Failed to configure API keys: ${error.message}`);
      return;
    }

    const calculationResult = calculateTopicQuestions(topics, totalQuestions);
    const topicsWithQuestions = calculationResult.topics;
    const totalQuestionsToGenerate = calculationResult.totalQuestionsToGenerate;
    const extraQuestionsCount = calculationResult.extraQuestionsCount;
    
    const totalTopicsToProcess = topicsWithQuestions.filter(t => t.questionsToGenerate > 0).length;

    if (extraQuestionsCount > 0) {
      toast.success(`🎯 Generating ${totalQuestions} questions + ${extraQuestionsCount} extra questions for zero-weightage topics = ${totalQuestionsToGenerate} total questions`);
    }

    // Reset session counters at the start of generation
    if (generationMode === 'new_questions') {
      setGeneratedCount(prev => ({ ...prev, new: 0 }));
    } else {
      setGeneratedCount(prev => ({ ...prev, pyq: 0 }));
    }

    setProgress({
      currentTopic: '',
      currentTopicIndex: 0,
      totalTopics: totalTopicsToProcess,
      currentQuestionInTopic: 0,
      totalQuestionsInTopic: 0,
      totalQuestionsGenerated: 0,
      totalQuestionsTarget: totalQuestionsToGenerate,
      isGenerating: true,
      isPaused: false,
      stage: generationMode === 'new_questions' ? 'questions' : 'pyq_solutions'
    });

    try {
      if (generationMode === 'new_questions') {
        await generateNewQuestions(topicsWithQuestions);
      } else {
        await generatePYQSolutions();
      }
    } catch (error) {
      console.error('Generation error:', error);
      toast.error(`Generation failed: ${error.message}`);
    } finally {
      setProgress(prev => ({ ...prev, isGenerating: false, isPaused: false }));
    }
  };

  const generateNewQuestions = async (topicsWithQuestions: any[]) => {
    const examName = exams.find(e => e.id === selectedExam)?.name || '';
    const courseName = courses.find(c => c.id === selectedCourse)?.name || '';

    let totalGenerated = 0;
    const allGeneratedQuestions: ExtractedQuestion[] = [];

    for (let topicIndex = 0; topicIndex < topicsWithQuestions.length; topicIndex++) {
      const topic = topicsWithQuestions[topicIndex];

      if (topic.questionsToGenerate === 0) continue;

      setProgress(prev => ({
        ...prev,
        currentTopic: topic.name,
        currentTopicIndex: topicIndex + 1,
        currentQuestionInTopic: 0,
        totalQuestionsInTopic: topic.questionsToGenerate
      }));

      // Get PYQs for this topic for inspiration
      const { data: pyqs, error: pyqError } = await supabase
        .from('questions_topic_wise')
        .select('question_statement, options, answer, solution, question_type, year, slot, part')
        .eq('topic_id', topic.id)
        .order('year', { ascending: false });

      if (pyqError) {
        console.error('Error loading PYQs:', pyqError);
      }

      // Get already generated questions for this topic
      const { data: allExistingQuestions, error: existingError } = await supabase
        .from('new_questions')
        .select('question_statement, options, answer')
        .eq('topic_id', topic.id)
        .eq('question_type', questionType)
        .order('created_at', { ascending: false });

      if (existingError) {
        console.error('Error loading existing questions:', existingError);
      }

      // Format existing questions for AI context
      const existingQuestionsContext = (allExistingQuestions || []).map((q, index) => 
        `${index + 1}. ${q.question_statement}${q.options ? `\nOptions: ${q.options.join(', ')}` : ''}${q.answer ? `\nAnswer: ${q.answer}` : ''}`
      ).join('\n\n');

      // Generate questions for this topic
      for (let questionIndex = 0; questionIndex < topic.questionsToGenerate; questionIndex++) {
        if (progress.isPaused) {
          await new Promise(resolve => {
            const checkPause = () => {
              if (!progress.isPaused) {
                resolve(undefined);
              } else {
                setTimeout(checkPause, 1000);
              }
            };
            checkPause();
          });
        }

        setProgress(prev => ({
          ...prev,
          currentQuestionInTopic: questionIndex + 1
        }));

        // Try to generate a valid question (with retry logic)
        let validQuestionGenerated = false;
        let attempts = 0;
        const maxAttempts = 5; // Maximum attempts to generate a valid question
        
        while (!validQuestionGenerated && attempts < maxAttempts) {
          attempts++;
          
          try {
            const isZeroWeightage = (topic.weightage || 0) === 0;
            const topicTypeLabel = isZeroWeightage ? '(Zero-weightage topic)' : `(${((topic.weightage || 0.02) * 100).toFixed(1)}% weightage)`;
            
            toast(`🤖 Gemini generating question ${questionIndex + 1}/${topic.questionsToGenerate} for ${topic.name} ${topicTypeLabel} (attempt ${attempts})...`, { duration: 2000 });

            const generatedQuestions = await generateQuestionsForTopic(
              topic,
              examName,
              courseName,
              questionType,
              pyqs || [],
              existingQuestionsContext,
              allGeneratedQuestions.filter(q => q.topic_id === topic.id).map(q => q.question_statement),
              1,
              topic.notes || '' // Pass topic notes for solution generation
            );

            if (generatedQuestions.length > 0) {
              const question = generatedQuestions[0];
              
              // Validate the question structure
              const validation = validateQuestionAnswer(question);

              if (!validation.isValid) {
                toast.error(`❌ Question validation failed: ${validation.reason}. Retrying...`);
                console.log('Invalid question:', {
                  question: question.question_statement,
                  options: question.options,
                  answer: question.answer,
                  reason: validation.reason
                });

                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 3000));
                continue;
              }

              // Additional validation for options
              if ((questionType === 'MCQ' || questionType === 'MSQ') && question.options) {
                if (question.options.length !== 4) {
                  toast.error(`❌ Question must have exactly 4 options. Got ${question.options.length}. Retrying...`);
                  await new Promise(resolve => setTimeout(resolve, 3000));
                  continue;
                }
              }
              
              // Question is valid, save to database
              const questionToSave = {
                topic_id: topic.id,
                topic_name: topic.name,
                chapter_id: topic.chapter_id,
                question_statement: question.question_statement,
                question_type: questionType,
                options: question.options,
                answer: question.answer,
                solution: question.solution,
                slot: selectedSlot || null,
                part: selectedPart || null,
                correct_marks: questionConfig.correct_marks,
                incorrect_marks: questionConfig.incorrect_marks,
                skipped_marks: questionConfig.skipped_marks,
                partial_marks: questionConfig.partial_marks,
                time_minutes: questionConfig.time_minutes,
                difficulty_level: 'Medium',
                purpose: 'practice'
              };

              const { data, error } = await supabase
                .from('new_questions')
                .insert([questionToSave])
                .select();

              if (error) {
                console.error('Error saving question:', error);
                toast.error(`Failed to save question: ${error.message}`);
              } else {
                totalGenerated++;
                allGeneratedQuestions.push(question);
                validQuestionGenerated = true;

                // Add this question to existing questions context for next iterations
                if (allExistingQuestions) {
                  allExistingQuestions.unshift({
                    question_statement: question.question_statement,
                    options: question.options,
                    answer: question.answer
                  });
                }

                // Keep only last 3 questions for preview
                setRecentQuestions(prev => {
                  const updated = [...prev, question];
                  return updated.slice(-3);
                });

                // Update both progress and session counter
                setProgress(prev => ({
                  ...prev,
                  totalQuestionsGenerated: totalGenerated
                }));

                setGeneratedCount(prev => ({ ...prev, new: totalGenerated }));

                const successMessage = isZeroWeightage
                  ? `✅ Question ${questionIndex + 1} for zero-weightage topic validated and saved!`
                  : `✅ Question ${questionIndex + 1} validated and saved!`;
                toast.success(successMessage);
              }
            }

            // Delay between attempts/questions
            await new Promise(resolve => setTimeout(resolve, 8000));

          } catch (error) {
            console.error(`Error generating question ${questionIndex + 1} for topic ${topic.name} (attempt ${attempts}):`, error);
            toast.error(`Failed to generate question ${questionIndex + 1} (attempt ${attempts}): ${error.message}`);
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
        
        // If we couldn't generate a valid question after max attempts
        if (!validQuestionGenerated) {
          toast.error(`⚠️ Could not generate valid question ${questionIndex + 1} for ${topic.name} after ${maxAttempts} attempts. Skipping...`);
          console.warn(`Skipped question ${questionIndex + 1} for topic ${topic.name} after ${maxAttempts} failed attempts`);
        }
      }

      // Delay between topics
      if (topicIndex < topicsWithQuestions.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    toast.success(`🎉 Generation complete! Generated ${totalGenerated} questions across ${topicsWithQuestions.filter(t => t.questionsToGenerate > 0).length} topics!`);
  };

  const generatePYQSolutions = async () => {
    try {
      // First get all topics for the selected course
      const { data: courseTopics, error: topicsError } = await supabase
        .from('topics')
        .select('id, name, notes, chapter_id, chapters!inner(course_id)')
        .eq('chapters.course_id', selectedCourse);

      if (topicsError) {
        console.error('Error loading topics:', topicsError);
        toast.error('Failed to load topics');
        return;
      }

      if (!courseTopics || courseTopics.length === 0) {
        toast.error('No topics found for this course');
        return;
      }

      const topicIds = courseTopics.map(t => t.id);

      // Get total PYQs for this course
      const { data: allPYQs, error: allPYQsError } = await supabase
        .from('questions_topic_wise')
        .select('id, answer, solution')
        .in('topic_id', topicIds);

      if (allPYQsError) {
        console.error('Error loading all PYQs:', allPYQsError);
        toast.error(`Failed to load PYQ statistics: ${allPYQsError.message}`);
        return;
      }

      // Calculate statistics
      const totalPYQs = allPYQs?.length || 0;
      const pyqsWithAnswer = allPYQs?.filter(pyq => pyq.answer && pyq.answer.trim() !== '').length || 0;
      const pyqsWithSolution = allPYQs?.filter(pyq => pyq.solution && pyq.solution.trim() !== '').length || 0;
      const pyqsWithBoth = allPYQs?.filter(pyq =>
        pyq.answer && pyq.answer.trim() !== '' &&
        pyq.solution && pyq.solution.trim() !== ''
      ).length || 0;

      // Show analysis
      toast.success(
        `📊 PYQ Analysis:\n` +
        `Total PYQs: ${totalPYQs}\n` +
        `With Answer: ${pyqsWithAnswer} (${((pyqsWithAnswer/totalPYQs)*100).toFixed(1)}%)\n` +
        `With Solution: ${pyqsWithSolution} (${((pyqsWithSolution/totalPYQs)*100).toFixed(1)}%)\n` +
        `Complete (Both): ${pyqsWithBoth} (${((pyqsWithBoth/totalPYQs)*100).toFixed(1)}%)`,
        { duration: 10000 }
      );

      // Now get PYQs without solutions from these topics
      const { data: pyqsWithoutSolutions, error } = await supabase
        .from('questions_topic_wise')
        .select('*')
        .in('topic_id', topicIds)
        .or('solution.is.null,solution.eq.,answer.is.null,answer.eq.');

      if (error) {
        console.error('Error loading PYQs:', error);
        toast.error(`Failed to load PYQs: ${error.message}`);
        return;
      }

      const remaining = pyqsWithoutSolutions?.length || 0;

      if (!pyqsWithoutSolutions || pyqsWithoutSolutions.length === 0) {
        toast.success(`✅ All ${totalPYQs} PYQs already have complete solutions!`);
        return;
      }

      toast.info(`🚀 Starting generation for ${remaining} remaining PYQs...`, { duration: 5000 });

      // Create a map of topic_id to topic data for quick lookup
      const topicMap = new Map(courseTopics.map(t => [t.id, t]));

      // Enrich PYQs with topic data
      const enrichedPYQs = pyqsWithoutSolutions.map(pyq => ({
        ...pyq,
        topics: topicMap.get(pyq.topic_id)
      })).filter(pyq => pyq.topics); // Filter out any PYQs without valid topic data

      setProgress(prev => ({
        ...prev,
        totalQuestionsTarget: enrichedPYQs.length,
        stage: 'pyq_solutions'
      }));

      let solutionsGenerated = 0;

      for (let i = 0; i < enrichedPYQs.length; i++) {
        const pyq = enrichedPYQs[i];

        if (progress.isPaused) {
          await new Promise(resolve => {
            const checkPause = () => {
              if (!progress.isPaused) {
                resolve(undefined);
              } else {
                setTimeout(checkPause, 1000);
              }
            };
            checkPause();
          });
        }

        setProgress(prev => ({
          ...prev,
          currentTopic: pyq.topics.name,
          totalQuestionsGenerated: i + 1
        }));

        try {
          toast(`🤖 Gemini generating solution for PYQ ${i + 1}/${enrichedPYQs.length}...`, { duration: 2000 });

          const solutions = await generateSolutionsForPYQs([pyq], pyq.topics?.notes || '');

          if (solutions.length > 0) {
            const solution = solutions[0];

            // Prepare update data
            const updateData: any = {
              answer: solution.answer,
              solution: solution.solution
            };

            // Add slot and part if selected
            if (selectedSlot) {
              updateData.slot = selectedSlot;
            }
            if (selectedPart) {
              updateData.part = selectedPart;
            }

            // Update the PYQ with answer and solution
            const { error: updateError } = await supabase
              .from('questions_topic_wise')
              .update(updateData)
              .eq('id', pyq.id);

            if (updateError) {
              console.error('Error updating PYQ:', updateError);
              toast.error(`Failed to save solution: ${updateError.message}`);
            } else {
              solutionsGenerated++;
              setGeneratedCount(prev => ({ ...prev, pyq: solutionsGenerated }));
              toast.success(`✅ Solution ${i + 1} generated and saved!`);
            }
          }

          // Delay between solutions
          await new Promise(resolve => setTimeout(resolve, 8000));

        } catch (error) {
          console.error(`Error generating solution for PYQ ${i + 1}:`, error);
          toast.error(`Failed to generate solution ${i + 1}: ${error.message}`);
        }
      }

      toast.success(`🎉 PYQ Solutions complete! Generated ${solutionsGenerated} solutions!`);
    } catch (error) {
      console.error('Error in PYQ solution generation:', error);
      toast.error(`PYQ generation failed: ${error.message}`);
    }
  };

  const pauseGeneration = () => {
    setProgress(prev => ({ ...prev, isPaused: !prev.isPaused }));
    toast(progress.isPaused ? '▶️ Generation resumed' : '⏸️ Generation paused');
  };

  const stopGeneration = () => {
    setProgress(prev => ({ ...prev, isGenerating: false, isPaused: false }));
    toast('🛑 Generation stopped');
  };

  const getQuestionTypeIcon = (type: string) => {
    switch (type) {
      case 'MCQ': return <Circle className="w-4 h-4 text-blue-500" />;
      case 'MSQ': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'NAT': return <Hash className="w-4 h-4 text-orange-500" />;
      case 'Subjective': return <Edit3 className="w-4 h-4 text-purple-500" />;
      default: return <Circle className="w-4 h-4 text-gray-500" />;
    }
  };

  const calculationResult = calculateTopicQuestions(topics, totalQuestions);
  const topicsWithQuestions = calculationResult.topics;
  const totalQuestionsToGenerate = calculationResult.totalQuestionsToGenerate;
  const extraQuestionsCount = calculationResult.extraQuestionsCount;
  const zeroWeightageTopics = topics.filter(topic => (topic.weightage || 0) === 0);
  
  const validApiKeys = getValidApiKeys();
  const canStartGeneration = selectedExam && selectedCourse && topics.length > 0 && !progress.isGenerating;

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-indigo-50">
      <Toaster position="top-right" />
      
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center mb-6">
            <div className="bg-gradient-to-r from-purple-600 to-indigo-600 p-4 rounded-2xl shadow-lg">
              <Brain className="w-12 h-12 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent mb-4">
            AI Question Generator
          </h1>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto">
            Generate high-quality practice questions and solutions using AI, based on previous year questions and topic weightage
          </p>
          
          {/* Features */}
          <div className="flex items-center justify-center gap-8 mt-8 text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-500" />
              <span>Gemini-Powered</span>
            </div>
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-indigo-500" />
              <span>Weightage-Based</span>
            </div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-green-500" />
              <span>PYQ Analysis</span>
            </div>
          </div>
        </div>

        {/* Configuration Form */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
          {/* Gemini API Keys Section */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-purple-600" />
                <h3 className="text-lg font-semibold text-gray-800">
                  Gemini API Keys (Smart Round Robin)
                </h3>
              </div>
              <button
                onClick={addApiKey}
                disabled={apiKeys.length >= 100}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg font-medium shadow hover:shadow-lg transform hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                + Add API Key
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Add up to 100 Gemini API keys. The system will rotate them automatically and handle errors with 10-second delays.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Bulk Paste API Keys (One-Click Import)
              </label>
              <textarea
                onPaste={handleBulkApiKeyPaste}
                placeholder="Paste all your API keys here (each starting with AIzaSy). The system will automatically extract and separate them."
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all min-h-[100px]"
              />
              <p className="text-xs text-gray-500 mt-1">
                💡 Paste all keys at once - they'll be automatically separated by detecting "AIzaSy" pattern
              </p>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
              {apiKeys.map((key, index) => (
                <div key={index} className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-sm font-medium text-gray-700">
                        API Key {index + 1}
                      </label>
                      {index === 0 && (
                        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                          Required
                        </span>
                      )}
                    </div>
                    <input
                      type="password"
                      value={key}
                      onChange={(e) => updateApiKey(index, e.target.value)}
                      placeholder="AIzaSy..."
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                    />
                  </div>
                  {apiKeys.length > 1 && (
                    <button
                      onClick={() => removeApiKey(index)}
                      className="mt-6 p-2 text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      title="Remove this API key"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="text-sm font-semibold text-blue-900 mb-2">How it works:</h4>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• Keys are used in round-robin rotation (1st → 2nd → 3rd → ... → 1st)</li>
                <li>• If any key fails, it waits 10 seconds then switches to the next key</li>
                <li>• Keys with 3+ consecutive errors are temporarily disabled</li>
                <li>• Perfect for generating 1000+ questions without hitting rate limits</li>
              </ul>
            </div>

            {validApiKeys.length > 0 && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-green-800 text-sm font-medium">
                  ✅ {validApiKeys.length} API key{validApiKeys.length > 1 ? 's' : ''} configured and ready
                </p>
              </div>
            )}

            {validApiKeys.length === 0 && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-800 text-sm font-medium">
                  ❌ Please provide at least one Gemini API key to start generation
                </p>
              </div>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {/* Exam Selection */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                <BookOpen className="w-4 h-4" />
                Select Exam
              </label>
              <select
                value={selectedExam}
                onChange={(e) => setSelectedExam(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
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
                className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all disabled:bg-gray-50"
              >
                <option value="">Choose a course...</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Generation Mode */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                <Settings className="w-4 h-4" />
                Generation Mode
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="new_questions"
                    checked={generationMode === 'new_questions'}
                    onChange={(e) => setGenerationMode(e.target.value as any)}
                    className="w-4 h-4 text-purple-600 border-gray-300 focus:ring-purple-500"
                  />
                  <span className="text-sm">Generate New Questions</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="pyq_solutions"
                    checked={generationMode === 'pyq_solutions'}
                    onChange={(e) => setGenerationMode(e.target.value as any)}
                    className="w-4 h-4 text-purple-600 border-gray-300 focus:ring-purple-500"
                  />
                  <span className="text-sm">Generate PYQ Solutions</span>
                </label>
              </div>
            </div>
          </div>

          {/* Slot and Part Configuration */}
          {selectedCourse && (
            <div className="border-t border-gray-200 pt-8">
              <h3 className="text-lg font-semibold text-gray-800 mb-6">Paper Configuration (Optional)</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                    <Clock className="w-4 h-4" />
                    Slot
                  </label>
                  <select
                    value={selectedSlot}
                    onChange={(e) => setSelectedSlot(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                  >
                    <option value="">Select a slot (optional)</option>
                    {slots.map((slot) => (
                      <option key={slot.id} value={slot.slot_name}>
                        {slot.slot_name}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                    <BookOpen className="w-4 h-4" />
                    Part
                  </label>
                  <select
                    value={selectedPart}
                    onChange={(e) => setSelectedPart(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                  >
                    <option value="">Select a part (optional)</option>
                    {parts.map((part) => (
                      <option key={part.id} value={part.part_name}>
                        {part.part_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Question Configuration for New Questions */}
              {generationMode === 'new_questions' && (
                <div>
                  <h4 className="text-md font-semibold text-gray-800 mb-4">Question Configuration</h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
                    {/* Question Type */}
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                        {getQuestionTypeIcon(questionType)}
                        Question Type
                      </label>
                      <select
                        value={questionType}
                        onChange={(e) => setQuestionType(e.target.value as any)}
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                      >
                        <option value="MCQ">MCQ (Single Correct)</option>
                        <option value="MSQ">MSQ (Multiple Correct)</option>
                        <option value="NAT">NAT (Numerical Answer)</option>
                        <option value="Subjective">Subjective (Descriptive)</option>
                      </select>
                    </div>

                    {/* Total Questions */}
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                        <Hash className="w-4 h-4" />
                        Number of Questions
                      </label>
                      <input
                        type="number"
                        value={totalQuestions}
                        onChange={(e) => setTotalQuestions(parseInt(e.target.value) || 30)}
                        min="1"
                        max="2000"
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                      />
                    </div>

                    {/* Time per Question */}
                    <div>
                      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                        <Clock className="w-4 h-4" />
                        Time (minutes)
                      </label>
                      <input
                        type="number"
                        value={questionConfig.time_minutes}
                        onChange={(e) => setQuestionConfig(prev => ({ ...prev, time_minutes: parseFloat(e.target.value) || 3 }))}
                        min="0.5"
                        max="60"
                        step="0.5"
                        className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                      />
                    </div>
                  </div>

                  {/* Marking Scheme */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="text-xs font-medium text-gray-700 mb-2 block">Correct Marks</label>
                      <input
                        type="number"
                        value={questionConfig.correct_marks}
                        onChange={(e) => setQuestionConfig(prev => ({ ...prev, correct_marks: parseFloat(e.target.value) || 0 }))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-700 mb-2 block">Incorrect Marks</label>
                      <input
                        type="number"
                        value={questionConfig.incorrect_marks}
                        onChange={(e) => setQuestionConfig(prev => ({ ...prev, incorrect_marks: parseFloat(e.target.value) || 0 }))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-700 mb-2 block">Skipped Marks</label>
                      <input
                        type="number"
                        value={questionConfig.skipped_marks}
                        onChange={(e) => setQuestionConfig(prev => ({ ...prev, skipped_marks: parseFloat(e.target.value) || 0 }))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-700 mb-2 block">Partial Marks</label>
                      <input
                        type="number"
                        value={questionConfig.partial_marks}
                        onChange={(e) => setQuestionConfig(prev => ({ ...prev, partial_marks: parseFloat(e.target.value) || 0 }))}
                        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Topic Weightage Preview */}
        {generationMode === 'new_questions' && topics.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
            <h3 className="text-xl font-bold text-gray-800 mb-6">Topic Distribution Preview</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {topicsWithQuestions.slice(0, 12).map((topic, index) => (
                <div key={topic.id} className="bg-gradient-to-r from-purple-50 to-indigo-50 p-4 rounded-lg border border-purple-200">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-gray-800 truncate">{topic.name}</h4>
                    <div className="flex items-center gap-1 text-xs text-purple-600">
                      <TrendingUp className="w-3 h-3" />
                      {((topic.weightage || 0.02) * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Questions:</span>
                    <span className="font-semibold text-purple-700">{topic.questionsToGenerate}</span>
                  </div>
                </div>
              ))}
            </div>
            {topicsWithQuestions.length > 12 && (
              <p className="text-sm text-gray-500 mt-4 text-center">
                And {topicsWithQuestions.length - 12} more topics...
              </p>
            )}
          </div>
        )}

        {/* Generation Controls */}
        <div className="flex gap-4 justify-center mb-8">
          {!progress.isGenerating ? (
            <button
              onClick={startGeneration}
              disabled={!canStartGeneration}
              className="flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
            >
              <Play className="w-5 h-5" />
              {generationMode === 'new_questions' ? `🚀 Generate ${totalQuestions} Questions` : '🚀 Generate PYQ Solutions'}
            </button>
          ) : (
            <div className="flex gap-4">
              <button
                onClick={pauseGeneration}
                className="flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-yellow-500 to-orange-500 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all"
              >
                {progress.isPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                {progress.isPaused ? 'Resume' : 'Pause'}
              </button>
              
              <button
                onClick={stopGeneration}
                className="flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-red-500 to-red-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl transform hover:scale-105 transition-all"
              >
                Stop Generation
              </button>
            </div>
          )}
        </div>

        {/* Progress Indicator */}
        {progress.isGenerating && (
          <div className="bg-white rounded-2xl shadow-xl p-6 mb-8">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-medium text-blue-900">
                  🤖 DeepSeek {progress.stage === 'questions' ? 'Generating Questions' : 'Generating Solutions'}
                  {progress.isPaused && ' (Paused)'}
                </h3>
                <span className="text-sm font-medium text-blue-700">
                  {progress.totalQuestionsGenerated}/{progress.totalQuestionsTarget}
                </span>
              </div>
              <p className="text-sm text-blue-600 mb-3">
                📚 Current Topic: {progress.currentTopic}
              </p>
            </div>
            
            <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
              <div
                className="bg-gradient-to-r from-purple-600 to-indigo-600 h-3 rounded-full transition-all duration-300"
                style={{
                  width: `${(progress.totalQuestionsGenerated / progress.totalQuestionsTarget) * 100}%`
                }}
              />
            </div>
            
            {progress.totalTopics > 0 && (
              <p className="text-sm text-blue-600">
                🎯 Topic {progress.currentTopicIndex}/{progress.totalTopics} | 
                Question {progress.currentQuestionInTopic}/{progress.totalQuestionsInTopic} in current topic
              </p>
            )}
          </div>
        )}

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-2xl p-6 border border-blue-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="bg-blue-500 p-2 rounded-lg">
                <Zap className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-blue-800">New Questions Generated</h3>
            </div>
            <p className="text-3xl font-bold text-blue-900">{generatedCount.new}</p>
            <p className="text-sm text-blue-600 mt-1">Ready for practice</p>
          </div>
          
          <div className="bg-gradient-to-r from-green-50 to-green-100 rounded-2xl p-6 border border-green-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="bg-green-500 p-2 rounded-lg">
                <Award className="w-6 h-6 text-white" />
              </div>
              <h3 className="text-lg font-semibold text-green-800">PYQ Solutions Generated</h3>
            </div>
            <p className="text-3xl font-bold text-green-900">{generatedCount.pyq}</p>
            <p className="text-sm text-green-600 mt-1">Solutions completed</p>
          </div>
        </div>

        {/* Recent Questions Preview */}
        {recentQuestions.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800">
                🎉 Recently Generated Questions (Last 3)
              </h2>
            </div>
            
            <div className="space-y-6">
              {recentQuestions.map((question, index) => (
                <QuestionPreview
                  key={index}
                  question={question}
                  index={recentQuestions.length - index}
                  showControls={false}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}