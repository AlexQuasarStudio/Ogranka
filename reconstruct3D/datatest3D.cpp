#include <cstdio>
#include <cmath>
#include <vector>
using namespace std;


#define PI 3.14159265358979
#define max(a,b) ((a)>(b)? (a):(b))

double rvalue()    // [-1, 1]
{
    return (double(rand())/RAND_MAX - 0.5)*2;
}

struct point {double x,y; point (double xx, double yy): x(xx), y(yy) {} };

void AddPointProjection (int n, point &pt, double alp, double *prj, double rv)
{
    double h = 2*PI/n;
    double r = sqrt(pt.x*pt.x + pt.y*pt.y);
    double a = atan2(pt.y, pt.x) + alp;
    double pr;
    for (int i=0; i<n; i++) {
        pr = r*cos(i*h + a) + rv*rvalue();
        if (pr > prj[i]) prj[i] = pr;
    }
}




int main()
{
    int n = 400;
    double h = 2*PI/n;
    double *cont = new double[n];
    for (int i=0; i<n; i++) cont[i] = 0;
    
    vector<point> pt = {{3,1}, {1,3}, {-1,3}, {-3,1}, {-3,-1}, {-1,-3}, {1,-3}, {3,-1}};

    double rv = 0.008;
    for (double z = 0; z < 3.1; z += 0.1) {
    	for (auto p : pt) {
            AddPointProjection(n, p, 0.0, cont, rv);
    	}

    	for (int i=0; i<n; i++) {
       	    printf("%12.8f %12.8f %12.8f\n", i*h, cont[i], z);
    	}
    }

    delete [] cont;
    return 0;
}
