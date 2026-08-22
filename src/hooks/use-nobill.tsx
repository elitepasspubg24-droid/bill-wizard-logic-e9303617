import React, { createContext, useContext, useState } from 'react';

interface NoBillContextType {
  isNoBillMode: boolean;
  defaultPercentage: number;
  factoryPercentages: Record<string, number>;
  toggleMode: () => void;
  setDefaultPercentage: (percent: number) => void;
  setFactoryPercentage: (factoryId: string, percent: number) => void;
  calculateRate: (baseRate: number, factoryId?: string) => number;
}

const NoBillContext = createContext<NoBillContextType | undefined>(undefined);

export function NoBillProvider({ children }: { children: React.ReactNode }) {
  const [isNoBillMode, setIsNoBillMode] = useState(false);
  const [defaultPercentage, setDefaultPercentage] = useState(10);
  const [factoryPercentages, setFactoryPercentages] = useState<Record<string, number>>({});

  const toggleMode = () => setIsNoBillMode((prev) => !prev);
  
  const calculateRate = (baseRate: number, factoryId?: string) => {
    if (!isNoBillMode) return baseRate; // Reverses to normal bill rate
    
    const appliedPercentage = (factoryId && factoryPercentages[factoryId]) 
      ? factoryPercentages[factoryId] 
      : defaultPercentage;
      
    return baseRate + (baseRate * (appliedPercentage / 100));
  };

  return (
    <NoBillContext.Provider value={{
      isNoBillMode, defaultPercentage, factoryPercentages,
      toggleMode, setDefaultPercentage, setFactoryPercentages, calculateRate
    }}>
      {children}
    </NoBillContext.Provider>
  );
}

export function useNoBill() {
  const context = useContext(NoBillContext);
  if (context === undefined) {
    throw new Error('useNoBill must be used within a NoBillProvider');
  }
  return context;
}
