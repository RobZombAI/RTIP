CXX = clang++
CXXFLAGS = -std=c++17 -O2 -I/opt/homebrew/include -Wall -Wextra
LDFLAGS = -L/opt/homebrew/lib
LIBS = -lpthread

all: rtip-server

rtip-server: main.cpp
	$(CXX) $(CXXFLAGS) $(LDFLAGS) main.cpp -o rtip-server $(LIBS)

clean:
	rm -f rtip-server

install: rtip-server
	cp rtip-server /usr/local/bin/rtip-server

.PHONY: all clean install
